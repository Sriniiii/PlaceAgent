from __future__ import annotations

from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile, WebSocket
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.services import PlaceAgentStore
from app.voice_live import run_voice_interview_session


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.store = PlaceAgentStore()
    scheduler = AsyncIOScheduler()
    scheduler.add_job(app.state.store.run_watchdog, "cron", hour=0, minute=0)
    scheduler.start()
    yield
    scheduler.shutdown()


app = FastAPI(title="PlaceAgent", lifespan=lifespan)
app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")


def get_store(request: Request) -> PlaceAgentStore:
    return request.app.state.store


@app.get("/", response_class=HTMLResponse)
async def index(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(request, "index.html", {})


@app.get("/student", response_class=HTMLResponse)
async def student_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(request, "student.html", {})


@app.get("/tpc", response_class=HTMLResponse)
async def tpc_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(request, "tpc.html", {})


@app.get("/hr", response_class=HTMLResponse)
async def hr_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(request, "hr.html", {})


@app.get("/api/bootstrap")
async def bootstrap(request: Request):
    store = get_store(request)
    students = store.list_students()
    return {
        "ai": store.ai_config(),
        "stats": store.dashboard_stats(),
        "students": [student.model_dump() for student in students],
        "alerts": [alert.model_dump() for alert in store.current_alerts()],
        "agent_logs": [log.model_dump() for log in store.recent_logs()],
        "featured_student_id": students[0].id if students else None,
    }


@app.get("/api/students/{student_id}")
async def student_detail(student_id: str, request: Request):
    store = get_store(request)
    try:
        return store.get_student(student_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Student not found") from exc


@app.post("/api/students/{student_id}/resume")
async def upload_resume(student_id: str, request: Request, file: UploadFile = File(...)):
    store = get_store(request)
    try:
        content = await file.read()
        return await store.handle_resume_upload(student_id, file.filename or "resume.txt", content)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Student not found") from exc


@app.post("/api/students")
async def create_student(
    request: Request,
    name: str = Form(...),
    degree: str = Form(...),
    branch: str = Form(...),
    graduation_year: int = Form(...),
    target_roles: str = Form(""),
    preferred_companies: str = Form(""),
    file: UploadFile = File(...),
):
    store = get_store(request)
    content = await file.read()
    return await store.create_student(
        name=name,
        degree=degree,
        branch=branch,
        graduation_year=graduation_year,
        target_roles=[item.strip() for item in target_roles.split(",") if item.strip()],
        preferred_companies=[item.strip() for item in preferred_companies.split(",") if item.strip()],
        filename=file.filename or "resume.txt",
        content=content,
    )


@app.websocket("/ws/students/{student_id}/interview/voice")
async def voice_interview_ws(websocket: WebSocket, student_id: str, tone: str = Query("supportive")):
    store = websocket.app.state.store
    await run_voice_interview_session(websocket, store, student_id, tone)


@app.post("/api/students/{student_id}/interview/start")
async def start_interview(student_id: str, request: Request, tone: str = Form("supportive")):
    store = get_store(request)
    try:
        return await store.start_interview(student_id, tone=tone)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Student not found") from exc


@app.post("/api/students/{student_id}/interview/{session_id}/reply")
async def reply_interview(student_id: str, session_id: str, request: Request, answer: str = Form(...)):
    store = get_store(request)
    try:
        return await store.answer_interview(student_id, session_id, answer)
    except (KeyError, StopIteration) as exc:
        raise HTTPException(status_code=404, detail="Interview session not found") from exc


@app.get("/api/progress/{student_id}")
async def progress(student_id: str, request: Request):
    try:
        return get_store(request).progress(student_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Student not found") from exc


@app.patch("/api/tasks/{task_id}")
async def update_task(task_id: str, request: Request, student_id: str = Form(...), status: str = Form(...)):
    try:
        return get_store(request).update_task(student_id, task_id, status)
    except (KeyError, StopIteration) as exc:
        raise HTTPException(status_code=404, detail="Task not found") from exc


@app.post("/api/chat")
async def chat(request: Request, student_id: str = Form(...), message: str = Form(...)):
    try:
        return await get_store(request).chat(student_id, message)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Student not found") from exc


@app.get("/api/chat/history/{student_id}")
async def chat_history(student_id: str, request: Request):
    return get_store(request).chat_history(student_id)


@app.get("/api/tpc/alerts")
async def tpc_alerts(request: Request):
    return get_store(request).current_alerts()


@app.patch("/api/tpc/alerts/{alert_id}/resolve")
async def resolve_alert(alert_id: str, request: Request):
    try:
        return get_store(request).resolve_alert(alert_id)
    except StopIteration as exc:
        raise HTTPException(status_code=404, detail="Alert not found") from exc


@app.patch("/api/tpc/alerts/{alert_id}/escalate")
async def escalate_alert(alert_id: str, request: Request):
    try:
        return get_store(request).escalate_alert(alert_id)
    except StopIteration as exc:
        raise HTTPException(status_code=404, detail="Alert not found") from exc


@app.get("/api/tpc/analytics")
async def tpc_analytics(request: Request):
    return get_store(request).analytics()


@app.post("/api/tpc/reports/generate", response_class=PlainTextResponse)
async def tpc_report(request: Request):
    return get_store(request).generate_report()


@app.get("/api/agents/logs")
async def agent_logs(request: Request):
    return get_store(request).recent_logs()


@app.post("/api/admin/run-watchdog")
async def run_watchdog(request: Request):
    return await get_store(request).run_watchdog()


@app.post("/api/hr/jd/upload")
async def upload_jd(request: Request, company_name: str = Form(...), role_title: str = Form(...), requirements: str = Form(...)):
    return get_store(request).create_job_description(company_name, role_title, requirements)


@app.get("/api/hr/jd")
async def list_jd(request: Request):
    return get_store(request).list_job_descriptions()


@app.get("/api/hr/shortlist/{jd_id}")
async def shortlist(jd_id: str, request: Request):
    try:
        return await get_store(request).shortlist(jd_id)
    except StopIteration as exc:
        raise HTTPException(status_code=404, detail="Job description not found") from exc


@app.post("/api/hr/invite")
async def send_invite(
    request: Request,
    student_id: str = Form(...),
    jd_id: str = Form(...),
    interview_date: str = Form(...),
    message: str = Form(""),
):
    store = get_store(request)
    try:
        return store.create_invite(student_id, jd_id, interview_date, message)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Student not found") from exc


@app.post("/api/hr/explain-match")
async def explain_match(
    request: Request,
    student_id: str = Form(...),
    jd_id: str = Form(...),
):
    store = get_store(request)
    try:
        return await store.explain_match(student_id, jd_id)
    except (KeyError, StopIteration) as exc:
        raise HTTPException(status_code=404, detail="Student or job description not found") from exc
