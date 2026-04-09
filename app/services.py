from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from app.agents import InsightAgent, InterviewerAgent, MatcherAgent, MentorAgent, PlannerAgent, ScoutAgent, WatchdogAgent
from app.config import settings
from app.data import seed_alerts, seed_students
from app.llm import StructuredLLM
from app.models import (
    AdminRunResult,
    AgentLog,
    Alert,
    ChatMessage,
    ChatReplyResult,
    InterviewReplyResult,
    InterviewSession,
    JobDescription,
    ProgressSnapshot,
    ResumeUploadResult,
    ShortlistResult,
    Student,
    StudentCreateResult,
    TaskItem,
    TaskUpdateResult,
    TpcAnalytics,
)


@dataclass
class PlaceAgentStore:
    students: dict[str, Student] = field(default_factory=dict)
    alerts: list[Alert] = field(default_factory=list)
    agent_trace: list[AgentLog] = field(default_factory=list)
    chats: dict[str, list[ChatMessage]] = field(default_factory=dict)
    job_descriptions: list[JobDescription] = field(default_factory=list)
    llm: StructuredLLM = field(default_factory=StructuredLLM)
    scout: ScoutAgent = field(init=False)
    matcher: MatcherAgent = field(init=False)
    planner: PlannerAgent = field(init=False)
    interviewer: InterviewerAgent = field(init=False)
    watchdog: WatchdogAgent = field(init=False)
    mentor: MentorAgent = field(init=False)
    insight: InsightAgent = field(init=False)

    def __post_init__(self) -> None:
        if not self.students:
            self.students = {student.id: student for student in seed_students()}
        if not self.alerts:
            self.alerts = seed_alerts()
        self.scout = ScoutAgent(self.llm)
        self.matcher = MatcherAgent(self.llm)
        self.planner = PlannerAgent(self.llm)
        self.interviewer = InterviewerAgent(self.llm)
        self.watchdog = WatchdogAgent(self.llm)
        self.mentor = MentorAgent(self.llm)
        self.insight = InsightAgent(self.llm)

    def log(self, agent: str, title: str, detail: str) -> AgentLog:
        log = AgentLog(id=str(uuid.uuid4()), agent=agent, title=title, detail=detail, timestamp=datetime.now())
        self.agent_trace.insert(0, log)
        self.agent_trace = self.agent_trace[:30]
        return log

    def list_students(self) -> list[Student]:
        return list(self.students.values())

    def get_student(self, student_id: str) -> Student:
        return self.students[student_id]

    def ai_config(self) -> dict[str, str | bool]:
        return {"enabled": settings.ai_enabled, "model": settings.gemini_model}

    def dashboard_stats(self) -> dict[str, int]:
        students = self.list_students()
        avg = round(sum(student.readiness_score for student in students) / max(len(students), 1))
        interviews = sum(len(student.interview_history) for student in students)
        resumes = sum(1 for student in students if student.recent_resume_name)
        return {
            "active_students": len(students),
            "average_readiness": avg,
            "high_risk_students": len([student for student in students if student.readiness_score < 50]),
            "interviews_completed": interviews,
            "resumes_processed": resumes,
        }

    def recent_logs(self) -> list[AgentLog]:
        return self.agent_trace

    def current_alerts(self) -> list[Alert]:
        return sorted([alert for alert in self.alerts if not alert.resolved], key=lambda alert: alert.created_at, reverse=True)

    def create_student(
        self,
        *,
        name: str,
        degree: str,
        branch: str,
        graduation_year: int,
        target_roles: list[str],
        preferred_companies: list[str],
        filename: str,
        content: bytes,
    ) -> StudentCreateResult:
        student = Student(
            id=f"stu-{uuid.uuid4().hex[:8]}",
            name=name.strip(),
            degree=degree.strip(),
            branch=branch.strip(),
            graduation_year=graduation_year,
            target_roles=target_roles or ["Software Engineer"],
            preferred_companies=preferred_companies,
            readiness_score=30,
            confidence_score=35,
            interview_score=30,
            resume_score=30,
            skills=[],
            skill_gaps=[],
            strengths=[],
            improvement_priorities=[],
            summary="Profile created. Upload analysis in progress.",
            alerts_count=0,
            recent_resume_name=None,
            parsed_resume_excerpt=None,
            matches=[],
            weekly_plan=[],
            tasks=[],
            interview_history=[],
            last_login_at=datetime.now(),
            last_task_completion_at=None,
        )
        self.students[student.id] = student
        result = self.parse_resume(student.id, filename, content)
        self.log("orchestrator", "Student created", f"Created live student profile for {student.name} and triggered agent pipeline.")
        return StudentCreateResult(student=result.student, agent_trace=result.agent_trace, ai_enabled=result.ai_enabled, source=result.source)

    def parse_resume(self, student_id: str, filename: str, content: bytes) -> ResumeUploadResult:
        student = self.get_student(student_id)
        insight = self.scout.parse_resume(filename, content, student)
        extracted = insight["skills"]
        student.recent_resume_name = filename
        student.parsed_resume_excerpt = insight["parsed_excerpt"]
        student.skills = sorted(set(student.skills) | set(extracted))
        student.summary = insight["summary"]
        student.strengths = insight.get("strengths", [])[:4]
        student.improvement_priorities = insight.get("improvement_priorities", [])[:4]
        student.skill_gaps = insight.get("skill_gaps", student.skill_gaps)[:4]
        student.target_roles = insight.get("suggested_roles", student.target_roles)[:4]
        student.resume_score = max(20, min(96, int(insight.get("resume_score", student.resume_score))))
        student.confidence_score = max(20, min(95, int(insight.get("confidence_score", student.confidence_score))))
        scout_log = self.log("scout", "Resume parsed", f"Scout extracted {len(extracted)} skills from {filename} using {self.scout.last_source}.")

        student.matches = self.matcher.generate_matches(student)
        matcher_log = self.log("matcher", "Company matches refreshed", f"Matcher recalculated shortlist potential using {self.matcher.last_source}.")

        plan_result = self.planner.build_plan(student)
        student.weekly_plan = plan_result["weekly_plan"]
        student.tasks = self._build_tasks(student.id, plan_result["task_blueprint"])
        planner_log = self.log("planner", "Prep plan regenerated", f"Planner produced an updated roadmap using {self.planner.last_source}.")

        completion_rate = self._completion_rate(student)
        student.readiness_score = min(98, round((student.resume_score + student.interview_score + student.confidence_score + completion_rate) / 4))
        student.alerts_count = len([alert for alert in self.alerts if alert.student_id == student.id and not alert.resolved])
        ai_enabled = self.scout.last_ai_enabled or self.matcher.last_ai_enabled or self.planner.last_ai_enabled
        source = self.scout.last_source if self.scout.last_ai_enabled else "fallback"
        return ResumeUploadResult(student=student, extracted_skills=sorted(extracted), agent_trace=[scout_log, matcher_log, planner_log], ai_enabled=ai_enabled, source=source)

    def _build_tasks(self, student_id: str, blueprint: list[dict]) -> list[TaskItem]:
        tasks: list[TaskItem] = []
        today = date.today()
        for week_data in blueprint:
            week = int(week_data.get("week", 1))
            for idx, task in enumerate(week_data.get("tasks", []), start=1):
                tasks.append(
                    TaskItem(
                        id=f"task-{uuid.uuid4().hex[:8]}",
                        student_id=student_id,
                        week=week,
                        title=task.get("title", f"Week {week} Task {idx}"),
                        description=task.get("description", ""),
                        resource_url=task.get("resource_url"),
                        due_date=(today + timedelta(days=(week - 1) * 7 + idx)).isoformat(),
                        status="pending",
                        domain=task.get("domain"),
                    )
                )
        return tasks

    def _completion_rate(self, student: Student) -> int:
        if not student.tasks:
            return 0
        return round(100 * len([task for task in student.tasks if task.status == "done"]) / len(student.tasks))

    def update_task(self, student_id: str, task_id: str, status: str) -> TaskUpdateResult:
        student = self.get_student(student_id)
        task = next(item for item in student.tasks if item.id == task_id)
        task.status = status  # type: ignore[assignment]
        if status == "done":
            student.last_task_completion_at = datetime.now()
        completion_rate = self._completion_rate(student)
        student.readiness_score = min(98, round((student.resume_score + student.interview_score + student.confidence_score + completion_rate) / 4))
        return TaskUpdateResult(task=task, student=student)

    def progress(self, student_id: str) -> ProgressSnapshot:
        student = self.get_student(student_id)
        total_tasks = len(student.tasks)
        completed_tasks = len([task for task in student.tasks if task.status == "done"])
        completion_rate = self._completion_rate(student)
        ranked = sorted(self.list_students(), key=lambda item: item.readiness_score)
        percentile = 100 if len(ranked) <= 1 else round(100 * ranked.index(student) / (len(ranked) - 1))
        upcoming = sorted([task for task in student.tasks if task.status == "pending"], key=lambda item: item.due_date)[:5]
        return ProgressSnapshot(
            readiness_score=student.readiness_score,
            completion_rate=completion_rate,
            completed_tasks=completed_tasks,
            total_tasks=total_tasks,
            interview_scores=[session.overall_score for session in student.interview_history[:5]],
            percentile_rank=percentile,
            upcoming_tasks=upcoming,
        )

    def chat(self, student_id: str, message: str) -> ChatReplyResult:
        student = self.get_student(student_id)
        student.last_login_at = datetime.now()
        history = self.chats.setdefault(student_id, [])
        user_msg = ChatMessage(id=str(uuid.uuid4()), student_id=student_id, role="user", content=message, created_at=datetime.now())
        history.append(user_msg)
        reply_text = self.mentor.reply(student, history, message)
        assistant_msg = ChatMessage(id=str(uuid.uuid4()), student_id=student_id, role="assistant", content=reply_text, created_at=datetime.now())
        history.append(assistant_msg)
        return ChatReplyResult(reply=assistant_msg, history=history[-20:], ai_enabled=self.mentor.last_ai_enabled, source=self.mentor.last_source)

    def chat_history(self, student_id: str) -> list[ChatMessage]:
        return self.chats.get(student_id, [])

    def start_interview(self, student_id: str, tone: str = "supportive") -> InterviewSession:
        student = self.get_student(student_id)
        student.last_login_at = datetime.now()
        session = InterviewSession(
            id=str(uuid.uuid4()),
            student_id=student_id,
            started_at=datetime.now(),
            tone="challenging" if tone == "challenging" else "supportive",
            current_question=self.interviewer.next_question(student, tone, 0) or "Tell me about yourself.",
            overall_score=max(40, student.interview_score),
        )
        student.interview_history.insert(0, session)
        self.log("interviewer", "Interview launched", f"Interviewer started a {session.tone} session for {student.name} using {self.interviewer.last_source}.")
        return session

    def answer_interview(self, student_id: str, session_id: str, answer: str) -> InterviewReplyResult:
        student = self.get_student(student_id)
        session = next(item for item in student.interview_history if item.id == session_id)
        turn_index = len(session.turns)
        turn, score_delta, next_question, report_summary = self.interviewer.evaluate_answer(student, session.current_question, answer, turn_index)
        session.turns.append(turn)
        session.overall_score = max(35, min(98, session.overall_score + score_delta))
        student.interview_score = max(student.interview_score, session.overall_score)
        student.confidence_score = min(95, student.confidence_score + max(score_delta, 1))
        student.readiness_score = min(98, round((student.resume_score + student.interview_score + student.confidence_score + self._completion_rate(student)) / 4))
        session.report_summary = report_summary
        if turn_index + 1 >= 3:
            session.status = "completed"
            session.current_question = "Interview completed"
            self.log("interviewer", "Interview report generated", f"Interviewer closed the session for {student.name} with a score of {session.overall_score} using {self.interviewer.last_source}.")
            next_question = None
        else:
            session.current_question = next_question or "Continue."
            self.log("interviewer", "Interview answer evaluated", f"Answer {turn_index + 1} evaluated for {student.name}; next question queued via {self.interviewer.last_source}.")
        return InterviewReplyResult(
            session=session,
            latest_feedback=turn.feedback,
            next_question=next_question,
            recommended_resources=self.interviewer.recommended_resources(student),
            ai_enabled=self.interviewer.last_ai_enabled,
            source=self.interviewer.last_source,
        )

    def run_watchdog(self) -> AdminRunResult:
        trace: list[AgentLog] = []
        today = date.today().isoformat()
        operational_alerts: list[Alert] = []
        for student in self.list_students():
            overdue = [task for task in student.tasks if task.status == "pending" and task.due_date < today]
            if len(overdue) >= 2 and not any(alert.student_id == student.id and alert.type == "missed_deadline" and not alert.resolved for alert in self.alerts):
                operational_alerts.append(
                    Alert(
                        id=f"alert-{uuid.uuid4().hex[:8]}",
                        student_id=student.id,
                        student_name=student.name,
                        type="missed_deadline",
                        severity="high",
                        title="Multiple missed deadlines detected",
                        detail=f"{student.name} has {len(overdue)} overdue tasks and needs intervention.",
                        created_at=datetime.now(),
                    )
                )
            if student.last_login_at and student.last_login_at < datetime.now() - timedelta(days=5):
                if not any(alert.student_id == student.id and alert.type == "inactive" and not alert.resolved for alert in self.alerts):
                    operational_alerts.append(
                        Alert(
                            id=f"alert-{uuid.uuid4().hex[:8]}",
                            student_id=student.id,
                            student_name=student.name,
                            type="inactive",
                            severity="medium",
                            title="Inactivity detected",
                            detail=f"{student.name} has not been active in the last 5 days.",
                            created_at=datetime.now(),
                        )
                    )
        self.alerts = operational_alerts + self.alerts
        new_alerts = self.watchdog.scan(self.list_students(), self.alerts)
        self.alerts = new_alerts + self.alerts
        trace.append(self.log("watchdog", "Watchdog scan complete", f"Watchdog reviewed {len(self.students)} students and raised {len(new_alerts) + len(operational_alerts)} alerts using {self.watchdog.last_source}."))
        for student in self.list_students():
            student.alerts_count = len([alert for alert in self.alerts if alert.student_id == student.id and not alert.resolved])
        return AdminRunResult(alerts=new_alerts + operational_alerts, agent_trace=trace, ai_enabled=self.watchdog.last_ai_enabled, source=self.watchdog.last_source)

    def resolve_alert(self, alert_id: str) -> Alert:
        alert = next(item for item in self.alerts if item.id == alert_id)
        alert.resolved = True
        return alert

    def escalate_alert(self, alert_id: str) -> Alert:
        alert = next(item for item in self.alerts if item.id == alert_id)
        alert.escalated = True
        return alert

    def analytics(self) -> TpcAnalytics:
        return self.insight.analytics(self.list_students())

    def generate_report(self) -> str:
        analytics = self.analytics()
        lines = ["PlaceAgent Cohort Report", f"Generated at: {datetime.now().isoformat()}", ""]
        lines.append("Readiness by Branch:")
        lines.extend([f"- {branch}: {score}%" for branch, score in analytics.readiness_by_branch.items()])
        lines.append("")
        lines.append("Prediction Scores:")
        lines.extend([f"- {name}: {score}" for name, score in analytics.prediction_scores.items()])
        return "\n".join(lines)

    def create_job_description(self, company_name: str, role_title: str, requirements: str) -> JobDescription:
        jd = JobDescription(
            id=f"jd-{uuid.uuid4().hex[:8]}",
            company_name=company_name,
            role_title=role_title,
            requirements=requirements,
            extracted_skills=self._extract_jd_skills(requirements),
            created_at=datetime.now(),
        )
        self.job_descriptions.insert(0, jd)
        self.log("insight", "Job description uploaded", f"{company_name} uploaded {role_title} for shortlist generation.")
        return jd

    def _extract_jd_skills(self, requirements: str) -> list[str]:
        text = requirements.lower()
        catalog = ["react", "javascript", "typescript", "python", "fastapi", "sql", "docker", "machine learning", "system design", "communication"]
        skills = [skill.title() if skill != "fastapi" else "FastAPI" for skill in catalog if skill in text]
        return skills or ["Problem Solving", "Communication"]

    def list_job_descriptions(self) -> list[JobDescription]:
        return self.job_descriptions

    def shortlist(self, jd_id: str) -> ShortlistResult:
        jd = next(item for item in self.job_descriptions if item.id == jd_id)
        candidates = self.insight.shortlist(jd, self.list_students())
        return ShortlistResult(jd=jd, candidates=candidates, ai_enabled=self.insight.last_ai_enabled, source=self.insight.last_source)
