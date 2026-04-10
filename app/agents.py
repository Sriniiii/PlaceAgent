from __future__ import annotations

import json
import re
from typing import AsyncIterator
from datetime import datetime

import fitz
import httpx

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
MAX_INTERVIEW_TURNS = 5

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


def _extract_resume_text(filename: str, content: bytes) -> str:
    if filename.lower().endswith(".pdf"):
        try:
            with fitz.open(stream=content, filetype="pdf") as document:
                pages = [page.get_text("text") for page in document]
            text = "\n".join(part.strip() for part in pages if part and part.strip())
            if text.strip():
                return text
        except Exception:
            pass
    return content.decode("utf-8", errors="ignore")


def _clean_resume_excerpt(text: str, max_len: int = 260) -> str:
    cleaned = re.sub(r"\s+", " ", text).strip()
    cleaned = re.sub(r"%PDF-\d\.\d.*?(?=[A-Za-z]{3,})", "", cleaned)
    return cleaned[:max_len]


def _extract_projects(text: str) -> list[str]:
    lines = [line.strip(" -•\t") for line in text.splitlines()]
    candidates = [line for line in lines if 12 <= len(line) <= 110 and re.search(r"\b(built|developed|created|designed|implemented|engineered|project|platform|dashboard|app|system)\b", line, re.I)]
    return candidates[:4]


def _extract_metrics(text: str) -> list[str]:
    return re.findall(r"\b\d+(?:\.\d+)?\s?(?:%|x|hours|days|users|clients|ms|sec|seconds?)\b", text, re.I)[:6]


def _infer_roles_from_text(text: str, existing_roles: list[str]) -> list[str]:
    lowered = text.lower()
    inferred: list[str] = []
    if any(word in lowered for word in ["react", "frontend", "css", "html", "figma", "next.js"]):
        inferred.append("Frontend Engineer")
    if any(word in lowered for word in ["fastapi", "api", "sql", "postgres", "backend", "docker"]):
        inferred.append("Backend Engineer")
    if any(word in lowered for word in ["machine learning", "pandas", "model", "data", "analytics"]):
        inferred.append("AI/ML Engineer")
    if not inferred:
        inferred = existing_roles[:]
    return inferred[:4]


def _derive_resume_fallback(student: Student, raw_text: str, filename: str, keyword_skills: list[str]) -> dict:
    extracted_projects = _extract_projects(raw_text)
    extracted_metrics = _extract_metrics(raw_text)
    inferred_roles = _infer_roles_from_text(raw_text, student.target_roles or ["Software Engineer"])
    strengths: list[str] = []
    priorities: list[str] = []
    gaps: list[str] = []

    if extracted_projects:
        strengths.append("Project experience is visible and can be turned into strong interview stories")
    else:
        priorities.append("Add at least 2 concrete projects with scope, stack, and outcomes")

    if extracted_metrics:
        strengths.append("There are measurable outcomes the resume can leverage")
    else:
        priorities.append("Quantify project impact with metrics like latency, users, or accuracy")

    if "React" in keyword_skills or "Next.js" in keyword_skills:
        strengths.append("Frontend stack alignment is visible")
    if "Python" in keyword_skills or "FastAPI" in keyword_skills or "SQL" in keyword_skills:
        strengths.append("Backend fundamentals are visible")
    if not keyword_skills:
        priorities.append("Use clearer skill keywords so the resume is machine-readable")

    if inferred_roles and "Frontend Engineer" in inferred_roles and "JavaScript" not in keyword_skills:
        gaps.append("JavaScript depth")
    if inferred_roles and "Backend Engineer" in inferred_roles and "SQL" not in keyword_skills:
        gaps.append("SQL fundamentals")
    if inferred_roles and "AI/ML Engineer" in inferred_roles and "Machine Learning" not in keyword_skills:
        gaps.append("Machine learning fundamentals")
    if not gaps:
        gaps = student.skill_gaps[:3] or ["Interview structure", "Resume storytelling"]

    priorities.extend([
        "Make ownership explicit in each bullet using action-first language",
        "Align the top section to your target role with the strongest project first",
    ])

    skills = keyword_skills or student.skills[:5]
    excerpt = _clean_resume_excerpt(raw_text) or f"Parsed {filename} with low-confidence extraction."
    summary_bits = []
    if extracted_projects:
        summary_bits.append(f"Resume suggests experience across {len(extracted_projects)} concrete project stories")
    if inferred_roles:
        summary_bits.append(f"Best aligned with {', '.join(inferred_roles[:2])}")
    if extracted_metrics:
        summary_bits.append(f"Includes measurable outcomes like {', '.join(extracted_metrics[:2])}")
    summary = ". ".join(summary_bits) or "Resume content was extracted, but it needs stronger role alignment and clearer impact statements."

    resume_score = 42
    resume_score += min(18, len(skills) * 3)
    resume_score += min(12, len(extracted_projects) * 4)
    resume_score += min(10, len(extracted_metrics) * 3)
    confidence_score = min(90, 45 + len(skills) * 4 + len(extracted_projects) * 3)

    return {
        "summary": summary,
        "resume_score": min(96, resume_score),
        "confidence_score": confidence_score,
        "skills": skills,
        "skill_gaps": gaps[:4],
        "strengths": list(dict.fromkeys(strengths))[:4] or ["Resume has enough signal for targeted improvement"],
        "improvement_priorities": list(dict.fromkeys(priorities))[:4],
        "parsed_excerpt": excerpt,
        "suggested_roles": inferred_roles[:4],
    }


def _dynamic_question_bank(student: Student, tone: str) -> list[str]:
    target = student.target_roles[0] if student.target_roles else "Software Engineer"
    gap = student.skill_gaps[0] if student.skill_gaps else "system design"
    strongest_skill = student.skills[0] if student.skills else student.branch
    project_hint = student.parsed_resume_excerpt or "your strongest project"
    bank = [
        f"Walk me through your strongest project and how it prepares you for a {target} role.",
        f"You currently need to improve on {gap}. How are you working on it, and how would you explain it in an interview?",
        f"I can see signals around {strongest_skill}. Tell me about a technical decision you made, the tradeoff you considered, and the result.",
    ]
    if "frontend" in target.lower():
        bank[0] = "Tell me about the frontend project you are most proud of, the UI decisions you made, and how you measured success."
    if "backend" in target.lower():
        bank[0] = "Describe the backend or API system you built, the architecture you chose, and how you handled performance or reliability."
    if tone == "challenging":
        bank = [question + " Give me specific numbers, constraints, and outcomes." for question in bank]
    return bank


class ScoutAgent(BaseAgent):
    name = "scout"

    async def parse_resume(self, filename: str, content: bytes, student: Student) -> dict:
        raw_text = _extract_resume_text(filename, content)
        lower_text = raw_text.lower()
        keyword_skills = sorted({pretty for key, pretty in SKILL_KEYWORDS.items() if key in lower_text})

        def fallback() -> dict:
            return _derive_resume_fallback(student, raw_text, filename, keyword_skills)

        payload = self._remember(
            await self.llm.generate_json(
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
        payload["parsed_excerpt"] = _clean_resume_excerpt(payload.get("parsed_excerpt", "") or raw_text) or f"Parsed {filename}."
        if not payload.get("suggested_roles"):
            payload["suggested_roles"] = _infer_roles_from_text(raw_text, student.target_roles)
        if not payload.get("strengths") or not payload.get("improvement_priorities"):
            fallback_payload = _derive_resume_fallback(student, raw_text, filename, keyword_skills)
            payload["strengths"] = payload.get("strengths") or fallback_payload["strengths"]
            payload["improvement_priorities"] = payload.get("improvement_priorities") or fallback_payload["improvement_priorities"]
            payload["skill_gaps"] = payload.get("skill_gaps") or fallback_payload["skill_gaps"]
            payload["summary"] = payload.get("summary") or fallback_payload["summary"]
        return payload


class MatcherAgent(BaseAgent):
    name = "matcher"

    async def generate_matches(self, student: Student) -> list[MatchResult]:
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
            await self.llm.generate_json(
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

    async def build_plan(self, student: Student) -> dict:
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
            await self.llm.generate_json(
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

    async def next_question(self, student: Student, tone: str, turn_index: int) -> str | None:
        if turn_index >= MAX_INTERVIEW_TURNS:
            return None

        def fallback() -> dict:
            dynamic_bank = _dynamic_question_bank(student, tone)
            prompt = dynamic_bank[turn_index] if turn_index < len(dynamic_bank) else dynamic_bank[-1]
            return {"question": prompt}

        payload = self._remember(
            await self.llm.generate_json(
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
        if payload.get("question"):
            return payload["question"]
        dynamic_bank = _dynamic_question_bank(student, tone)
        return dynamic_bank[turn_index] if turn_index < len(dynamic_bank) else dynamic_bank[-1]

    async def evaluate_answer(self, student: Student, question: str, answer: str, turn_index: int) -> tuple[InterviewTurn, int, str | None, str]:
        heur_score = self._score_answer(answer)

        def fallback() -> dict:
            dynamic_bank = _dynamic_question_bank(student, session_tone := ("challenging" if "specific numbers" in question.lower() else "supportive"))
            next_index = turn_index + 1
            next_question = None if next_index >= MAX_INTERVIEW_TURNS else (dynamic_bank[next_index] if next_index < len(dynamic_bank) else dynamic_bank[-1])
            summary = "Good progress. Keep making your ownership, metrics, and outcomes explicit."
            return {
                "feedback": self._feedback_for_answer(answer, heur_score),
                "score_delta": heur_score,
                "next_question": next_question,
                "report_summary": summary,
            }

        payload = self._remember(
            await self.llm.generate_json(
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

    async def scan(self, students: list[Student], existing_alerts: list[Alert]) -> list[Alert]:
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
                await self.llm.generate_json(
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

    async def reply(self, student: Student, history: list[ChatMessage], user_message: str) -> str:
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
            await self.llm.generate_json(
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

    async def reply_stream(self, student: Student, history: list[ChatMessage], user_message: str) -> AsyncIterator[str]:
        def fallback() -> str:
            next_focus = student.improvement_priorities[0] if student.improvement_priorities else "completing this week's tasks"
            strongest = student.strengths[0] if student.strengths else "building resume impact and mock interview consistency"
            return (
                f"For {student.name}, focus next on {next_focus}. "
                f"Your strongest direction right now is {strongest}."
            )

        if not self.llm.enabled or not self.llm.api_key:
            self.last_ai_enabled = False
            self.last_source = "fallback"
            for token in fallback().split():
                yield token + " "
            return

        try:
            async with httpx.AsyncClient(timeout=45) as client:
                async with client.stream(
                    "POST",
                    f"{self.llm.base_url}/{self.llm.model}:streamGenerateContent",
                    params={"alt": "sse"},
                    headers={
                        "Content-Type": "application/json",
                        "x-goog-api-key": self.llm.api_key,
                    },
                    json={
                        "contents": [
                            {
                                "role": "user",
                                "parts": [
                                    {
                                        "text": (
                                            "You are CoachAgent, a supportive but sharp placement mentor.\n\n"
                                            f"Student: {student.model_dump_json()}\n"
                                            f"Recent history: {[msg.model_dump() for msg in history[-6:]]}\n"
                                            f"Student question: {user_message}\n"
                                            "Reply in plain text, be concise, actionable, and placement-focused."
                                        )
                                    }
                                ],
                            }
                        ],
                        "generationConfig": {
                            "temperature": 0.4,
                        },
                    },
                ) as response:
                    response.raise_for_status()
                    self.last_ai_enabled = True
                    self.last_source = self.llm.model
                    async for line in response.aiter_lines():
                        if not line or not line.startswith("data:"):
                            continue
                        payload = line[5:].strip()
                        if not payload or payload == "[DONE]":
                            continue
                        try:
                            data = json.loads(payload)
                        except Exception:
                            continue
                        for part in data.get("candidates", [{}])[0].get("content", {}).get("parts", []):
                            text = part.get("text")
                            if text:
                                yield text
                    return
        except Exception:
            self.last_ai_enabled = False
            self.last_source = "fallback"
            for token in fallback().split():
                yield token + " "


class InsightAgent(BaseAgent):
    name = "insight"

    async def shortlist(self, jd: JobDescription, students: list[Student]) -> list[ShortlistCandidate]:
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
            await self.llm.generate_json(
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
