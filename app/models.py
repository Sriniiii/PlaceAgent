from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


AgentName = Literal["scout", "matcher", "planner", "interviewer", "watchdog", "orchestrator", "coach", "insight"]
AlertSeverity = Literal["low", "medium", "high"]
InterviewTone = Literal["supportive", "challenging"]
TaskStatus = Literal["pending", "done", "missed"]
AlertType = Literal["missed_deadline", "score_drop", "inactive", "support_needed"]


class AgentLog(BaseModel):
    id: str
    agent: AgentName
    title: str
    detail: str
    timestamp: datetime


class MatchResult(BaseModel):
    company: str
    role: str
    score: int = Field(ge=0, le=100)
    reason: str
    missing_skills: list[str] = Field(default_factory=list)


class WeeklyTask(BaseModel):
    week: int
    focus: str
    tasks: list[str]


class TaskItem(BaseModel):
    id: str
    student_id: str
    week: int
    title: str
    description: str
    resource_url: str | None = None
    due_date: str
    status: TaskStatus = "pending"
    domain: str | None = None


class InterviewTurn(BaseModel):
    question: str
    answer: str
    feedback: str
    score_delta: int


class InterviewSession(BaseModel):
    id: str
    student_id: str
    started_at: datetime
    tone: InterviewTone = "supportive"
    current_question: str
    turns: list[InterviewTurn] = Field(default_factory=list)
    overall_score: int = 55
    status: Literal["active", "completed"] = "active"
    report_summary: str | None = None


class Alert(BaseModel):
    id: str
    student_id: str
    student_name: str
    type: AlertType = "support_needed"
    severity: AlertSeverity
    title: str
    detail: str
    resolved: bool = False
    escalated: bool = False
    created_at: datetime


class Student(BaseModel):
    id: str
    name: str
    degree: str
    branch: str
    graduation_year: int
    target_roles: list[str]
    preferred_companies: list[str]
    readiness_score: int = Field(ge=0, le=100)
    confidence_score: int = Field(ge=0, le=100)
    interview_score: int = Field(ge=0, le=100)
    resume_score: int = Field(ge=0, le=100)
    skills: list[str]
    skill_gaps: list[str]
    strengths: list[str] = Field(default_factory=list)
    improvement_priorities: list[str] = Field(default_factory=list)
    summary: str
    alerts_count: int = 0
    recent_resume_name: str | None = None
    parsed_resume_excerpt: str | None = None
    matches: list[MatchResult] = Field(default_factory=list)
    weekly_plan: list[WeeklyTask] = Field(default_factory=list)
    tasks: list[TaskItem] = Field(default_factory=list)
    interview_history: list[InterviewSession] = Field(default_factory=list)
    last_login_at: datetime | None = None
    last_task_completion_at: datetime | None = None


class DashboardStats(BaseModel):
    active_students: int
    average_readiness: int
    high_risk_students: int
    interviews_completed: int
    resumes_processed: int


class ChatMessage(BaseModel):
    id: str
    student_id: str
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime


class ChatReplyResult(BaseModel):
    reply: ChatMessage
    history: list[ChatMessage]
    ai_enabled: bool
    source: str


class ProgressSnapshot(BaseModel):
    readiness_score: int
    completion_rate: int
    completed_tasks: int
    total_tasks: int
    interview_scores: list[int]
    percentile_rank: int
    upcoming_tasks: list[TaskItem]


class TaskUpdateResult(BaseModel):
    task: TaskItem
    student: Student


class JobDescription(BaseModel):
    id: str
    company_name: str
    role_title: str
    requirements: str
    extracted_skills: list[str] = Field(default_factory=list)
    created_at: datetime


class ShortlistCandidate(BaseModel):
    student_id: str
    student_name: str
    branch: str
    graduation_year: int
    readiness_score: int
    match_percentage: int
    reason: str


class ShortlistResult(BaseModel):
    jd: JobDescription
    candidates: list[ShortlistCandidate]
    ai_enabled: bool
    source: str


class TpcAnalytics(BaseModel):
    branch_distribution: dict[str, int]
    readiness_by_branch: dict[str, int]
    prediction_scores: dict[str, int]


class ResumeUploadResult(BaseModel):
    student: Student
    extracted_skills: list[str]
    agent_trace: list[AgentLog]
    ai_enabled: bool
    source: str


class StudentCreateResult(BaseModel):
    student: Student
    agent_trace: list[AgentLog]
    ai_enabled: bool
    source: str


class InterviewReplyResult(BaseModel):
    session: InterviewSession
    latest_feedback: str
    next_question: str | None = None
    recommended_resources: list[str]
    ai_enabled: bool
    source: str


class AdminRunResult(BaseModel):
    alerts: list[Alert]
    agent_trace: list[AgentLog]
    ai_enabled: bool
    source: str
