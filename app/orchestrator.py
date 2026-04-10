from __future__ import annotations

from typing import Any, TypedDict

try:
    from langgraph.graph import END, START, StateGraph
except Exception:  # pragma: no cover - optional dependency during local edits
    END = "__end__"
    START = "__start__"
    StateGraph = None  # type: ignore[assignment]

from app.models import AgentLog


class ResumePipelineState(TypedDict, total=False):
    store: Any
    student_id: str
    filename: str
    content: bytes
    logs: list[AgentLog]
    steps: list[dict[str, Any]]


def _append_step(state: ResumePipelineState, ai_enabled: bool, source: str) -> None:
    state.setdefault("steps", []).append({"ai_enabled": ai_enabled, "source": source})


def _append_log(state: ResumePipelineState, log: AgentLog) -> None:
    state.setdefault("logs", []).append(log)


def build_resume_graph():
    if StateGraph is None:
        return _LinearResumeGraph()
    workflow = StateGraph(ResumePipelineState)
    workflow.add_node("scout", _run_scout)
    workflow.add_node("matcher", _run_matcher)
    workflow.add_node("planner", _run_planner)
    workflow.add_edge(START, "scout")
    workflow.add_edge("scout", "matcher")
    workflow.add_edge("matcher", "planner")
    workflow.add_edge("planner", END)
    return workflow.compile()


class _LinearResumeGraph:
    async def ainvoke(self, state: ResumePipelineState) -> ResumePipelineState:
        state = await _run_scout(state)
        state = await _run_matcher(state)
        state = await _run_planner(state)
        return state


async def _run_scout(state: ResumePipelineState) -> ResumePipelineState:
    store = state["store"]
    student = store.get_student(state["student_id"])
    insight = await store.scout.parse_resume(state["filename"], state["content"], student)
    extracted = insight["skills"]
    student.recent_resume_name = state["filename"]
    student.parsed_resume_excerpt = insight["parsed_excerpt"]
    student.skills = sorted(set(student.skills) | set(extracted))
    student.summary = insight["summary"]
    student.strengths = insight.get("strengths", [])[:4]
    student.improvement_priorities = insight.get("improvement_priorities", [])[:4]
    student.skill_gaps = insight.get("skill_gaps", student.skill_gaps)[:4]
    student.target_roles = insight.get("suggested_roles", student.target_roles)[:4]
    student.resume_score = max(20, min(96, int(insight.get("resume_score", student.resume_score))))
    student.confidence_score = max(20, min(95, int(insight.get("confidence_score", student.confidence_score))))
    store.persist_student(student)
    _append_log(state, store.log("scout", "Resume parsed", f"Scout parsed {state['filename']} and emitted structured insights using {store.scout.last_source}."))
    _append_step(state, store.scout.last_ai_enabled, store.scout.last_source)
    return state


async def _run_matcher(state: ResumePipelineState) -> ResumePipelineState:
    store = state["store"]
    student = store.get_student(state["student_id"])
    student.matches = await store.matcher.generate_matches(student)
    store.persist_student(student)
    _append_log(state, store.log("matcher", "Company matches refreshed", f"Matcher ranked fitment opportunities for {student.name} using {store.matcher.last_source}."))
    _append_step(state, store.matcher.last_ai_enabled, store.matcher.last_source)
    return state


async def _run_planner(state: ResumePipelineState) -> ResumePipelineState:
    store = state["store"]
    student = store.get_student(state["student_id"])
    plan_result = await store.planner.build_plan(student)
    student.weekly_plan = plan_result["weekly_plan"]
    student.tasks = store.build_tasks(student.id, plan_result["task_blueprint"])
    completion_rate = store.completion_rate(student)
    student.readiness_score = min(98, round((student.resume_score + student.interview_score + student.confidence_score + completion_rate) / 4))
    student.alerts_count = len([alert for alert in store.alerts if alert.student_id == student.id and not alert.resolved])
    store.persist_student(student)
    _append_log(state, store.log("planner", "Prep plan regenerated", f"Planner built a fresh roadmap for {student.name} using {store.planner.last_source}."))
    _append_step(state, store.planner.last_ai_enabled, store.planner.last_source)
    return state
