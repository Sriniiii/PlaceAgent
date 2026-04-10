from __future__ import annotations

from datetime import date, datetime, timedelta

from app.models import Alert, MatchResult, Student, TaskItem, WeeklyTask


def seed_students() -> list[Student]:
    today = date.today()
    student_id = "stu-demo-risk"
    tasks = [
        TaskItem(
            id="task-demo-1",
            student_id=student_id,
            week=1,
            title="Complete arrays and hashing practice set",
            description="Finish the first 10 medium-level DSA problems and summarize patterns.",
            resource_url="https://leetcode.com/problemset/",
            due_date=(today - timedelta(days=3)).isoformat(),
            status="missed",
            domain="dsa",
        ),
        TaskItem(
            id="task-demo-2",
            student_id=student_id,
            week=1,
            title="Write quantified resume bullets",
            description="Rewrite the top three project bullets with outcomes, metrics, and ownership.",
            resource_url="https://www.indeed.com/career-advice/resumes-cover-letters/resume-action-words",
            due_date=(today - timedelta(days=2)).isoformat(),
            status="missed",
            domain="resume",
        ),
        TaskItem(
            id="task-demo-3",
            student_id=student_id,
            week=1,
            title="Attempt one timed mock interview",
            description="Record one mock interview round and note weak answers.",
            resource_url=None,
            due_date=(today - timedelta(days=1)).isoformat(),
            status="missed",
            domain="interview",
        ),
        TaskItem(
            id="task-demo-4",
            student_id=student_id,
            week=2,
            title="Revise SQL joins and aggregations",
            description="Practice joins, grouping, window basics, and explain each with an example.",
            resource_url="https://www.w3schools.com/sql/",
            due_date=(today + timedelta(days=2)).isoformat(),
            status="pending",
            domain="backend",
        ),
    ]
    return [
        Student(
            id=student_id,
            name="Aarav Mehta",
            degree="B.Tech",
            branch="Computer Science",
            graduation_year=today.year + 1,
            target_roles=["Backend Engineer", "Software Engineer"],
            preferred_companies=["Razorpay", "Atlassian", "Freshworks"],
            readiness_score=41,
            confidence_score=46,
            interview_score=39,
            resume_score=52,
            skills=["Python", "FastAPI", "SQL"],
            skill_gaps=["DSA consistency", "System design basics", "Quantified resume bullets"],
            strengths=["Backend fundamentals are visible", "Resume has enough technical signal for targeting product roles"],
            improvement_priorities=["Recover missed deadlines immediately", "Strengthen DSA practice cadence", "Rewrite project bullets with impact metrics"],
            summary="Backend-leaning profile with real potential, but repeated missed tasks now put placement momentum at risk.",
            alerts_count=1,
            recent_resume_name="aarav_backend_resume.pdf",
            parsed_resume_excerpt="Built FastAPI endpoints, student analytics dashboards, and SQL-backed internal tools during internships and projects.",
            matches=[
                MatchResult(
                    company="Razorpay",
                    role="Backend Intern",
                    score=78,
                    reason="Backend fundamentals align, but DSA consistency and system design still need work before interviews.",
                    missing_skills=["System Design Basics", "Advanced DSA"],
                )
            ],
            weekly_plan=[
                WeeklyTask(week=1, focus="Deadline recovery", tasks=["Clear missed tasks", "Rebuild daily prep cadence"]),
                WeeklyTask(week=2, focus="Interview foundations", tasks=["Timed DSA practice", "One mock interview"]),
            ],
            tasks=tasks,
            interview_history=[],
            last_login_at=datetime.now() - timedelta(days=2),
            last_task_completion_at=datetime.now() - timedelta(days=7),
        )
    ]


def seed_alerts() -> list[Alert]:
    return [
        Alert(
            id="alert-demo-risk",
            student_id="stu-demo-risk",
            student_name="Aarav Mehta",
            type="missed_deadline",
            severity="high",
            title="Three missed deadlines detected",
            detail="Aarav Mehta has missed three consecutive placement tasks and should be contacted by the TPC team.",
            created_at=datetime.now() - timedelta(hours=2),
        )
    ]
