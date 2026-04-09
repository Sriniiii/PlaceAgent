---
title: PlaceAgent
emoji: "🎓"
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
pinned: false
---

# PlaceAgent

PlaceAgent is a hackathon-ready autonomous AI placement operations system with:

- Animated landing page
- Student portal with readiness insights
- TPC dashboard with alerts
- Multi-agent backend workflows
- Resume upload + parsing simulation
- Mock interview loop + scorecard generation

## Run locally

```powershell
python -m uvicorn app.main:app --reload
```

Open `http://127.0.0.1:8000`.

## Run with Docker

```powershell
docker build -t placeagent .
docker run -p 7860:7860 -e GEMINI_API_KEY="your_key_here" placeagent
```

Then open `http://127.0.0.1:7860`.

## Deploy to Hugging Face Spaces

1. Create a new Space and choose `Docker`
2. Upload the contents of this folder
3. Add `GEMINI_API_KEY` in the Space secrets
4. Wait for the image build to finish

## Enable Real AI Agents With Gemini

```powershell
$env:GEMINI_API_KEY="your_key_here"
$env:PLACEAGENT_MODEL="gemini-2.5-flash"
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

## Core agents

- `ScoutAgent`: parses resume text and extracts skills
- `MatcherAgent`: scores company matches
- `PlannerAgent`: generates weekly prep plans
- `InterviewerAgent`: runs mock interview feedback loops
- `WatchdogAgent`: monitors readiness drops and risk alerts

## Notes

- The app is fully demoable offline with seeded data.
- If you later add a real LLM provider, the backend orchestration layer is the place to plug it in.

## Suggested Hackathon Phases

### Phase 1

- Ship the current MVP exactly as-is
- Demo the landing page, student portal, TPC dashboard, and agent trace
- Use seeded students so the judge flow is smooth

### Phase 2

- Plug in a real LLM provider for resume parsing and interview feedback
- Add PDF text extraction and persistent storage
- Save interview sessions and alerts to a database

### Phase 3

- Add recruiter/company portal
- Add authentication for students and TPC staff
- Add scheduled watchdog jobs and notification delivery

### Phase 4

- Deploy frontend and backend
- Add analytics, placement conversion tracking, and richer company matching
- Connect voice input/output for the interview loop
