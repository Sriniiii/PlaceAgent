from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.config import settings
from app.models import Alert, ChatMessage, InterviewSession, JobDescription, MatchResult, Student, TaskItem, WeeklyTask

try:
    from supabase import Client, create_client
except Exception:  # pragma: no cover - optional dependency during local edits
    Client = Any  # type: ignore[misc,assignment]

    def create_client(*args, **kwargs):  # type: ignore[no-redef]
        raise RuntimeError("Supabase client is unavailable")


def _serialize_student(student: Student) -> dict[str, Any]:
    return {
        "id": student.id,
        "user_id": student.id,
        "name": student.name,
        "degree": student.degree,
        "branch": student.branch,
        "graduation_year": student.graduation_year,
        "placement_target": ", ".join(student.target_roles[:2]) if student.target_roles else None,
        "target_roles": student.target_roles,
        "preferred_companies": student.preferred_companies,
        "parsed_skills": student.skills,
        "strengths": student.strengths,
        "improvement_priorities": student.improvement_priorities,
        "summary": student.summary,
        "recent_resume_name": student.recent_resume_name,
        "parsed_resume_excerpt": student.parsed_resume_excerpt,
        "resume_score": student.resume_score,
        "interview_score": student.interview_score,
        "confidence_score": student.confidence_score,
        "readiness_score": student.readiness_score,
        "alerts_count": student.alerts_count,
        "last_login_at": student.last_login_at.isoformat() if student.last_login_at else None,
        "last_task_completion_at": student.last_task_completion_at.isoformat() if student.last_task_completion_at else None,
        "updated_at": student.last_login_at.isoformat() if student.last_login_at else None,
    }


def _deserialize_student(
    row: dict[str, Any],
    *,
    tasks: list[TaskItem],
    interviews: list[InterviewSession],
    matches: list[MatchResult],
    weekly_plan: list[WeeklyTask],
    skill_gaps: list[str],
) -> Student:
    row = dict(row)
    return Student.model_validate(
        {
            "id": row["id"],
            "name": row["name"],
            "degree": row["degree"],
            "branch": row["branch"],
            "graduation_year": row["graduation_year"],
            "target_roles": row.get("target_roles") or [],
            "preferred_companies": row.get("preferred_companies") or [],
            "readiness_score": row.get("readiness_score", 0),
            "confidence_score": row.get("confidence_score", 0),
            "interview_score": row.get("interview_score", 0),
            "resume_score": row.get("resume_score", 0),
            "skills": row.get("parsed_skills") or [],
            "skill_gaps": skill_gaps,
            "strengths": row.get("strengths") or [],
            "improvement_priorities": row.get("improvement_priorities") or [],
            "summary": row.get("summary") or "",
            "alerts_count": row.get("alerts_count", 0),
            "recent_resume_name": row.get("recent_resume_name"),
            "parsed_resume_excerpt": row.get("parsed_resume_excerpt"),
            "matches": matches,
            "weekly_plan": weekly_plan,
            "tasks": tasks,
            "interview_history": interviews,
            "last_login_at": row.get("last_login_at"),
            "last_task_completion_at": row.get("last_task_completion_at"),
        }
    )


def _serialize_tasks(student: Student, plan_id: str) -> list[dict[str, Any]]:
    return [
        {
            "id": task.id,
            "plan_id": plan_id,
            "student_id": student.id,
            "week": task.week,
            "title": task.title,
            "description": task.description,
            "resource_url": task.resource_url,
            "due_date": task.due_date,
            "status": task.status,
            "domain": task.domain,
        }
        for task in student.tasks
    ]


def _serialize_interviews(student: Student) -> list[dict[str, Any]]:
    return [
        {
            "id": session.id,
            "student_id": student.id,
            "mode": session.mode,
            "interview_type": "general",
            "tone": session.tone,
            "current_question": session.current_question,
            "turns_json": [turn.model_dump(mode="json") for turn in session.turns],
            "score": session.overall_score,
            "status": session.status,
            "report_summary": session.report_summary,
            "started_at": session.started_at.isoformat(),
        }
        for session in student.interview_history
    ]


def _infer_gap_level(skill: str) -> str:
    lowered = skill.lower()
    if any(word in lowered for word in ["system", "design", "dsa", "ml", "sql"]):
        return "high"
    if any(word in lowered for word in ["api", "docker", "react", "python"]):
        return "medium"
    return "low"


@dataclass
class PersistenceSnapshot:
    students: list[Student] = field(default_factory=list)
    alerts: list[Alert] = field(default_factory=list)
    chats: dict[str, list[ChatMessage]] = field(default_factory=dict)
    job_descriptions: list[JobDescription] = field(default_factory=list)
    enabled: bool = False
    mode_label: str = "in-memory demo state"


class BaseRepository:
    enabled = False
    mode_label = "in-memory demo state"

    def load_snapshot(self) -> PersistenceSnapshot:
        return PersistenceSnapshot(enabled=self.enabled, mode_label=self.mode_label)

    def save_student(self, student: Student) -> None:
        return None

    def save_alert(self, alert: Alert) -> None:
        return None

    def update_alert(self, alert: Alert) -> None:
        return None

    def replace_chat_history(self, student_id: str, history: list[ChatMessage]) -> None:
        return None

    def save_job_description(self, jd: JobDescription) -> None:
        return None

    def update_task_status(self, student_id: str, task_id: str, status: str) -> None:
        return None

    def upsert_interview_session(self, student_id: str, session: InterviewSession) -> None:
        return None


@dataclass
class SupabaseRepository(BaseRepository):
    client: Client
    enabled: bool = True
    mode_label: str = "Supabase persistence"

    @classmethod
    def from_settings(cls) -> BaseRepository:
        if not settings.supabase_enabled:
            return BaseRepository()
        try:
            return cls(client=create_client(settings.supabase_url, settings.supabase_service_role_key))
        except Exception:
            return BaseRepository()

    def load_snapshot(self) -> PersistenceSnapshot:
        try:
            students_rows = self.client.table(settings.supabase_profiles_table).select("*").execute().data or []
            alerts_rows = self.client.table(settings.supabase_alerts_table).select("*").execute().data or []
            chats_rows = self.client.table(settings.supabase_chats_table).select("*").order("created_at").execute().data or []
            jd_rows = self.client.table(settings.supabase_jd_table).select("*").order("created_at", desc=True).execute().data or []
            tasks_rows = self.client.table("tasks").select("*").order("due_date").execute().data or []
            interviews_rows = self.client.table("mock_interviews").select("*").order("started_at", desc=True).execute().data or []
            plan_rows = self.client.table("preparation_plans").select("*").eq("status", "active").execute().data or []
            gap_rows = self.client.table("skill_gaps").select("*").execute().data or []
            chats: dict[str, list[ChatMessage]] = {}
            for row in chats_rows:
                message = ChatMessage.model_validate(row)
                chats.setdefault(message.student_id, []).append(message)
            tasks_by_student: dict[str, list[TaskItem]] = {}
            for row in tasks_rows:
                task = TaskItem.model_validate(row)
                tasks_by_student.setdefault(task.student_id, []).append(task)
            interviews_by_student: dict[str, list[InterviewSession]] = {}
            for row in interviews_rows:
                session = InterviewSession.model_validate(
                    {
                        "id": row["id"],
                        "student_id": row["student_id"],
                        "started_at": row["started_at"],
                        "mode": row.get("mode", "text"),
                        "tone": row.get("tone", "supportive"),
                        "current_question": row.get("current_question") or "Interview completed",
                        "turns": row.get("turns_json") or [],
                        "overall_score": row.get("score", 0),
                        "status": row.get("status", "active"),
                        "report_summary": row.get("report_summary"),
                    }
                )
                interviews_by_student.setdefault(session.student_id, []).append(session)
            plans_by_student: dict[str, list[WeeklyTask]] = {}
            matches_by_student: dict[str, list[MatchResult]] = {}
            for row in plan_rows:
                student_id = row["student_id"]
                plan_payload = row.get("plan_payload") or []
                plans_by_student[student_id] = [WeeklyTask.model_validate(item) for item in plan_payload]
                matches_by_student[student_id] = [MatchResult.model_validate(item) for item in (row.get("matches_payload") or [])]
            gaps_by_student: dict[str, list[str]] = {}
            for row in gap_rows:
                gaps_by_student.setdefault(row["profile_id"], []).append(row["skill"])
            return PersistenceSnapshot(
                students=[
                    _deserialize_student(
                        row,
                        tasks=tasks_by_student.get(row["id"], []),
                        interviews=interviews_by_student.get(row["id"], []),
                        matches=matches_by_student.get(row["id"], []),
                        weekly_plan=plans_by_student.get(row["id"], []),
                        skill_gaps=gaps_by_student.get(row["id"], []),
                    )
                    for row in students_rows
                ],
                alerts=[Alert.model_validate(row) for row in alerts_rows],
                chats=chats,
                job_descriptions=[JobDescription.model_validate(row) for row in jd_rows],
                enabled=True,
                mode_label=self.mode_label,
            )
        except Exception:
            return PersistenceSnapshot(enabled=False, mode_label="in-memory fallback (Supabase unavailable)")

    def save_student(self, student: Student) -> None:
        try:
            self.client.table("users").upsert(
                {
                    "id": student.id,
                    "email": None,
                    "role": "student",
                    "name": student.name,
                }
            ).execute()
            self.client.table(settings.supabase_profiles_table).upsert(_serialize_student(student)).execute()
            self.client.table("skill_gaps").delete().eq("profile_id", student.id).execute()
            if student.skill_gaps:
                self.client.table("skill_gaps").insert(
                    [
                        {
                            "profile_id": student.id,
                            "skill": gap,
                            "domain": student.branch,
                            "gap_level": _infer_gap_level(gap),
                        }
                        for gap in student.skill_gaps
                    ]
                ).execute()
            plan_id = f"plan-{student.id}"
            self.client.table("preparation_plans").upsert(
                {
                    "id": plan_id,
                    "student_id": student.id,
                    "domain": student.branch,
                    "plan_title": f"{student.name} placement roadmap",
                    "start_date": None,
                    "end_date": None,
                    "status": "active",
                    "plan_payload": [week.model_dump(mode="json") for week in student.weekly_plan],
                    "matches_payload": [match.model_dump(mode="json") for match in student.matches],
                }
            ).execute()
            self.client.table("tasks").delete().eq("student_id", student.id).execute()
            task_payload = _serialize_tasks(student, plan_id)
            if task_payload:
                self.client.table("tasks").insert(task_payload).execute()
            self.client.table("mock_interviews").delete().eq("student_id", student.id).execute()
            interview_payload = _serialize_interviews(student)
            if interview_payload:
                self.client.table("mock_interviews").insert(interview_payload).execute()
        except Exception:
            return None

    def save_alert(self, alert: Alert) -> None:
        try:
            self.client.table(settings.supabase_alerts_table).upsert(alert.model_dump(mode="json")).execute()
        except Exception:
            return None

    def update_alert(self, alert: Alert) -> None:
        self.save_alert(alert)

    def replace_chat_history(self, student_id: str, history: list[ChatMessage]) -> None:
        try:
            self.client.table(settings.supabase_chats_table).delete().eq("student_id", student_id).execute()
            if history:
                payload = [message.model_dump(mode="json") for message in history]
                self.client.table(settings.supabase_chats_table).insert(payload).execute()
        except Exception:
            return None

    def save_job_description(self, jd: JobDescription) -> None:
        try:
            self.client.table(settings.supabase_jd_table).upsert(jd.model_dump(mode="json")).execute()
        except Exception:
            return None

    def update_task_status(self, student_id: str, task_id: str, status: str) -> None:
        try:
            self.client.table("tasks").update({"status": status}).eq("student_id", student_id).eq("id", task_id).execute()
        except Exception:
            return None

    def upsert_interview_session(self, student_id: str, session: InterviewSession) -> None:
        try:
            self.client.table("mock_interviews").upsert(
                {
                    "id": session.id,
                    "student_id": student_id,
                    "mode": session.mode,
                    "interview_type": "general",
                    "tone": session.tone,
                    "current_question": session.current_question,
                    "turns_json": [turn.model_dump(mode="json") for turn in session.turns],
                    "score": session.overall_score,
                    "status": session.status,
                    "report_summary": session.report_summary,
                    "started_at": session.started_at.isoformat(),
                }
            ).execute()
        except Exception:
            return None
