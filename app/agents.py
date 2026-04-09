from __future__ import annotations

import re
from datetime import datetime

from app.llm import StructuredLLM
from app.models import Alert, ChatMessage, InterviewTurn, JobDescription, MatchResult, ShortlistCandidate, Student, TaskItem, TpcAnalytics, WeeklyTask


SKILL_KEYWORDS = {
    "react": "React",
    "next": "Next.js",
    "javascript": "JavaScript",
    "typescript": "TypeScript",
    "python": "Python",
    "fastapi": "FastAPI",
    "sql": "SQL",
    "postgres": "PostgreSQL",
    "docker": "Docker",
    "machine learning": "Machine Learning",
    "pandas": "Pandas",
    "power bi": "Power BI",
    "html": "HTML",
    "css": "CSS",
}

QUESTION_BANK = [
    "Tell me about yourself in a way that connects your background to this role.",
    "Describe a project where you solved a difficult technical problem under pressure.",
    "What tradeoffs did you make in your most important project?",
]

COMPANY_CATALOG = [
    {"company": "Atlassian", "role": "Product Engineer Intern", "skills": ["React", "JavaScript", "System Design Basics"]},
    {"company": "Adobe", "role": "Frontend Developer Intern", "skills": ["React", "CSS", "Quantified Resume Bullets"]},
    {"company": "Freshworks", "role": "Frontend Engineer Intern", "skills": ["React", "HTML", "JavaScript"]},
    {"company": "Razorpay", "role": "Backend Intern", "skills": ["Python", "FastAPI", "SQL"]},
    {"company": "Mu Sigma", "role": "Decision Scientist Intern", "skills": ["Python", "SQL", "Power BI"]},
    {"company": "NVIDIA", "role": "ML Tools Intern", "skills": ["Python", "Machine Learning", "Docker"]},
]


class BaseAgent:
    name = "agent"

    def __init__(self, llm: StructuredLLM) -> None:
        self.llm = llm
        self.last_source = "fallback"
        self.last_ai_enabled = False

    def _remember(self, result) -> dict:
        self.last_source = result.source
        self.last_ai_enabled = result.ai_enabled
        return result.payload


class ScoutAgent(BaseAgent):
    name = "scout"

    def parse_resume(self, filename: str, content: bytes, student: Student) -> dict:
        raw_text = content.decode("utf-8", errors="ignore")
        lower_text = raw_text.lower()
        keyword_skills = sorted({pretty for key, pretty in SKILL_KEYWORDS.items() if key in lower_text})

        def fallback() -> dict:
            extracted = keyword_skills or student.skills[:5]
            strengths = [
                "Shows practical project exposure",
                "Demonstrates relevant technical tools",
                "Has enough raw material for shortlist improvement",
            ]
            priorities = [
                "Add measurable impact to project bullets",
                "Sharpen role-specific keywords",
                "Make ownership and outcomes more explicit",
            ]
            return {
                "summary": "Resume shows useful technical promise, but still needs sharper outcomes, role targeting, and impact-driven storytelling.",
                "resume_score": min(96, max(45, student.resume_score + 8)),
                "confidence_score": min(95, max(student.confidence_score, 58)),
                "skills": extracted,
                "skill_gaps": student.skill_gaps[:3],
                "strengths": strengths,
                "improvement_priorities": priorities,
                "parsed_excerpt": " ".join(raw_text.split())[:260] or f"Parsed {filename} with baseline skill extraction.",
                "suggested_roles": student.target_roles[:3],
            }

        payload = self._remember(
            self.llm.generate_json(
                system_prompt=(
                    "You are ScoutAgent in a placement operations system. Analyze a student resume and return only valid JSON. "
                    "Be specific, practical, and placement-focused."
                ),
                user_prompt=(
                    f"Student profile: {student.model_dump_json()}\n"
                    f"Filename: {filename}\n"
                    f"Resume text:\n{raw_text[:7000]}\n\n"
                    "Return JSON with keys: summary, resume_score, confidence_score, skills, skill_gaps, strengths, "
                    "improvement_priorities, parsed_excerpt, suggested_roles."
                ),
                fallback=fallback,
            )
        )
        payload["skills"] = sorted(set(keyword_skills + payload.get("skills", [])))
        if not payload["skills"]:
            payload["skills"] = student.skills[:5]
        return payload


class MatcherAgent(BaseAgent):
    name = "matcher"

    def generate_matches(self, student: Student) -> list[MatchResult]:
        def fallback() -> dict:
            matches = []
            student_skills = set(student.skills)
            for item in COMPANY_CATALOG:
                overlap = sorted(student_skills.intersection(item["skills"]))
                missing = sorted(set(item["skills"]) - student_skills)
                score = min(96, 55 + len(overlap) * 13 + max(0, student.resume_score - 50) // 4)
                matches.append(
                    {
                        "company": item["company"],
                        "role": item["role"],
                        "score": score,
                        "reason": f"Matched on {', '.join(overlap) if overlap else 'baseline profile fit'}; strongest next step is closing {', '.join(missing[:2]) if missing else 'communication polish'}.",
                        "missing_skills": missing[:3],
                    }
                )
            matches.sort(key=lambda m: m["score"], reverse=True)
            return {"matches": matches[:3]}

        payload = self._remember(
            self.llm.generate_json(
                system_prompt=(
                    "You are MatcherAgent. Rank job-role matches for a placement platform. Return only valid JSON. "
                    "Use realistic shortlist reasoning and note missing skills."
                ),
                user_prompt=(
                    f"Student profile: {student.model_dump_json()}\n"
                    f"Company catalog: {COMPANY_CATALOG}\n"
                    "Return JSON with key matches. Each match must contain company, role, score, reason, missing_skills. "
                    "Return top 3 only."
                ),
                fallback=fallback,
            )
        )
        return [MatchResult(**item) for item in payload.get("matches", [])[:3]]


class PlannerAgent(BaseAgent):
    name = "planner"

    def build_plan(self, student: Student) -> dict:
        def fallback() -> dict:
            top_gap = student.skill_gaps[0] if student.skill_gaps else "Interview structure"
            return {
                "plan": [
                    {
                        "week": 1,
                        "focus": "Resume optimization",
                        "tasks": [
                            {"title": "Rewrite top 3 bullets with metrics", "description": "Quantify outcomes in the strongest projects.", "resource_url": "https://www.indeed.com/career-advice/resumes-cover-letters/resume-action-words", "domain": "resume"},
                            {"title": "Move strongest project to top", "description": "Lead with the project most aligned to the target role.", "resource_url": "https://leetcode.com", "domain": "resume"},
                        ],
                    },
                    {
                        "week": 2,
                        "focus": top_gap,
                        "tasks": [
                            {"title": f"Revise {top_gap}", "description": "Study the core concepts and make a one-page note.", "resource_url": "https://www.geeksforgeeks.org", "domain": "technical"},
                            {"title": "Complete 1 mock round", "description": "Do one focused interview round on the weakest area.", "resource_url": None, "domain": "interview"},
                        ],
                    },
                    {
                        "week": 3,
                        "focus": "Interview performance",
                        "tasks": [
                            {"title": "Practice STAR answers", "description": "Write 3 behavioural answers in STAR format.", "resource_url": "https://hbr.org", "domain": "hr"},
                            {"title": "Run 2 timed mock interviews", "description": "Simulate pressure and pacing.", "resource_url": None, "domain": "interview"},
                        ],
                    },
                ]
            }

        payload = self._remember(
            self.llm.generate_json(
                system_prompt=(
                    "You are PlannerAgent. Build a realistic 3-week placement prep plan with high-leverage weekly focus areas. "
                    "Return only valid JSON."
                ),
                user_prompt=(
                    f"Student profile: {student.model_dump_json()}\n"
                    "Return JSON with key plan. Each item must contain week, focus, tasks. "
                    "Each task must contain title, description, resource_url, domain."
                ),
                fallback=fallback,
            )
        )
        plan = [WeeklyTask(week=item["week"], focus=item["focus"], tasks=[task["title"] for task in item.get("tasks", [])]) for item in payload.get("plan", [])[:3]]
        return {"weekly_plan": plan, "task_blueprint": payload.get("plan", [])[:3]}


class InterviewerAgent(BaseAgent):
    name = "interviewer"

    def next_question(self, student: Student, tone: str, turn_index: int) -> str | None:
        if turn_index >= 3:
            return None

        def fallback() -> dict:
            prompt = QUESTION_BANK[turn_index]
            if tone == "challenging":
                prompt += " Be precise and include measurable outcomes."
            return {"question": prompt}

        payload = self._remember(
            self.llm.generate_json(
                system_prompt=(
                    "You are InterviewerAgent. Generate realistic interview questions for campus placements. "
                    "Return only valid JSON."
                ),
                user_prompt=(
                    f"Student profile: {student.model_dump_json()}\n"
                    f"Tone: {tone}\nTurn index: {turn_index}\n"
                    "Return JSON with key question."
                ),
                fallback=fallback,
            )
        )
        return payload.get("question") or QUESTION_BANK[turn_index]

    def evaluate_answer(self, student: Student, question: str, answer: str, turn_index: int) -> tuple[InterviewTurn, int, str | None, str]:
        heur_score = self._score_answer(answer)

        def fallback() -> dict:
            next_question = QUESTION_BANK[turn_index + 1] if turn_index + 1 < len(QUESTION_BANK) else None
            summary = "Good progress. Keep making your ownership, metrics, and outcomes explicit."
            return {
                "feedback": self._feedback_for_answer(answer, heur_score),
                "score_delta": heur_score,
                "next_question": next_question,
                "report_summary": summary,
            }

        payload = self._remember(
            self.llm.generate_json(
                system_prompt=(
                    "You are InterviewerAgent. Evaluate a student's interview answer like a strong placement coach. "
                    "Return only valid JSON."
                ),
                user_prompt=(
                    f"Student profile: {student.model_dump_json()}\n"
                    f"Question: {question}\n"
                    f"Answer: {answer}\n"
                    f"Turn index: {turn_index}\n"
                    "Return JSON with keys feedback, score_delta, next_question, report_summary. "
                    "score_delta should be an integer between 1 and 7."
                ),
                fallback=fallback,
            )
        )
        score_delta = max(1, min(7, int(payload.get("score_delta", heur_score))))
        turn = InterviewTurn(question=question, answer=answer, feedback=payload.get("feedback", fallback()["feedback"]), score_delta=score_delta)
        return turn, score_delta, payload.get("next_question"), payload.get("report_summary", "")

    def recommended_resources(self, student: Student) -> list[str]:
        return [
            f"Revise top gap: {student.skill_gaps[0]}" if student.skill_gaps else "Revise interview foundations",
            "Practice one STAR-format answer for teamwork",
            "Record a 60-second self-introduction video",
        ]

    def _score_answer(self, answer: str) -> int:
        word_count = len(re.findall(r"\w+", answer))
        mentions_metric = bool(re.search(r"\b\d+[%x]?\b", answer))
        mentions_impact = bool(re.search(r"\b(improved|reduced|built|shipped|optimized|led|designed)\b", answer, re.I))
        score = 1
        if word_count > 35:
            score += 3
        elif word_count > 20:
            score += 2
        if mentions_metric:
            score += 2
        if mentions_impact:
            score += 2
        return min(7, score)

    def _feedback_for_answer(self, answer: str, score_delta: int) -> str:
        hints: list[str] = []
        if not re.search(r"\b\d+[%x]?\b", answer):
            hints.append("add one metric or measurable result")
        if not re.search(r"\b(improved|reduced|built|led|designed|launched|optimized)\b", answer, re.I):
            hints.append("make your personal contribution clearer")
        if len(answer.split()) < 18:
            hints.append("expand with context, action, and outcome")
        if not hints:
            return f"Strong answer. You were specific, impact-oriented, and clear. Score gain: +{score_delta}."
        return f"Promising answer, but you should {', '.join(hints)}. Score gain: +{score_delta}."


class WatchdogAgent(BaseAgent):
    name = "watchdog"

    def scan(self, students: list[Student], existing_alerts: list[Alert]) -> list[Alert]:
        existing_keys = {(alert.student_id, alert.title) for alert in existing_alerts}
        alerts: list[Alert] = []

        for student in students:
            if student.readiness_score >= 70 and student.alerts_count == 0:
                continue

            def fallback(student: Student = student) -> dict:
                severity = "high" if student.readiness_score < 50 else "medium"
                return {
                    "raise_alert": student.readiness_score < 72 or bool(student.skill_gaps),
                    "severity": severity,
                    "title": "High-risk placement readiness" if severity == "high" else "Placement support recommended",
                    "type": "support_needed",
                    "detail": (
                        f"{student.name} needs intervention across readiness {student.readiness_score}, "
                        f"resume {student.resume_score}, interview {student.interview_score}. "
                        f"Main priorities: {', '.join(student.improvement_priorities[:2] or student.skill_gaps[:2])}."
                    ),
                }

            payload = self._remember(
                self.llm.generate_json(
                    system_prompt=(
                        "You are WatchdogAgent. Review student readiness and decide whether a TPC alert should be raised. "
                        "Return only valid JSON."
                    ),
                    user_prompt=(
                        f"Student profile: {student.model_dump_json()}\n"
                        "Return JSON with keys raise_alert, severity, title, type, detail."
                    ),
                    fallback=fallback,
                )
            )

            title = payload.get("title", "Placement support recommended")
            if not payload.get("raise_alert", False) or (student.id, title) in existing_keys:
                continue

            alerts.append(
                Alert(
                    id=f"alert-{student.id}-{int(datetime.now().timestamp())}",
                    student_id=student.id,
                    student_name=student.name,
                    type=payload.get("type", "support_needed"),
                    severity=payload.get("severity", "medium"),
                    title=title,
                    detail=payload.get("detail", fallback()["detail"]),
                    created_at=datetime.now(),
                )
            )
        return alerts


class MentorAgent(BaseAgent):
    name = "coach"

    def reply(self, student: Student, history: list[ChatMessage], user_message: str) -> str:
        def fallback() -> dict:
            next_focus = student.improvement_priorities[0] if student.improvement_priorities else "completing this week's tasks"
            strongest = student.strengths[0] if student.strengths else "building resume impact and mock interview consistency"
            return {
                "reply": (
                    f"For {student.name}, focus next on {next_focus}. "
                    f"Your strongest direction right now is {strongest}."
                )
            }

        payload = self._remember(
            self.llm.generate_json(
                system_prompt="You are CoachAgent, a supportive but sharp placement mentor. Return only JSON.",
                user_prompt=(
                    f"Student: {student.model_dump_json()}\n"
                    f"Recent history: {[msg.model_dump() for msg in history[-6:]]}\n"
                    f"Student question: {user_message}\n"
                    "Return JSON with key reply."
                ),
                fallback=fallback,
            )
        )
        return payload.get("reply", fallback()["reply"])


class InsightAgent(BaseAgent):
    name = "insight"

    def shortlist(self, jd: JobDescription, students: list[Student]) -> list[ShortlistCandidate]:
        def fallback() -> dict:
            candidates = []
            jd_skills = {skill.lower() for skill in jd.extracted_skills}
            for student in students:
                overlap = [skill for skill in student.skills if skill.lower() in jd_skills]
                score = min(98, 45 + len(overlap) * 14 + student.readiness_score // 5)
                candidates.append(
                    {
                        "student_id": student.id,
                        "student_name": student.name,
                        "branch": student.branch,
                        "graduation_year": student.graduation_year,
                        "readiness_score": student.readiness_score,
                        "match_percentage": score,
                        "reason": f"Matched on {', '.join(overlap[:4]) if overlap else 'general profile alignment'} and readiness score {student.readiness_score}%.",
                    }
                )
            candidates.sort(key=lambda item: item["match_percentage"], reverse=True)
            return {"candidates": candidates[:10]}

        payload = self._remember(
            self.llm.generate_json(
                system_prompt="You are InsightAgent. Rank candidate shortlists for a job description. Return only JSON.",
                user_prompt=(
                    f"Job description: {jd.model_dump_json()}\n"
                    f"Students: {[student.model_dump() for student in students]}\n"
                    "Return JSON with key candidates. Each candidate should have student_id, student_name, branch, graduation_year, readiness_score, match_percentage, reason."
                ),
                fallback=fallback,
            )
        )
        return [ShortlistCandidate(**item) for item in payload.get("candidates", [])]

    def analytics(self, students: list[Student]) -> TpcAnalytics:
        branch_distribution: dict[str, int] = {}
        readiness_by_branch: dict[str, int] = {}
        prediction_scores: dict[str, int] = {}
        grouped: dict[str, list[int]] = {}
        for student in students:
            branch_distribution[student.branch] = branch_distribution.get(student.branch, 0) + 1
            grouped.setdefault(student.branch, []).append(student.readiness_score)
            completion_rate = 0
            if student.tasks:
                completion_rate = round(100 * len([t for t in student.tasks if t.status == "done"]) / len(student.tasks))
            prediction_scores[student.name] = round(student.readiness_score * 0.4 + student.interview_score * 0.4 + completion_rate * 0.2)
        for branch, scores in grouped.items():
            readiness_by_branch[branch] = round(sum(scores) / len(scores))
        return TpcAnalytics(
            branch_distribution=branch_distribution,
            readiness_by_branch=readiness_by_branch,
            prediction_scores=prediction_scores,
        )
