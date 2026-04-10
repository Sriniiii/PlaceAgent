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
- Company HR portal with shortlist generation
- Multi-agent backend workflows
- Resume upload and parsing
- Mock interview loop and scorecard generation
- Task tracking, progress, and AI mentor chat

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

Live deployment:

- https://huggingface.co/spaces/sriniwassssssssss/PlaceAgent

## Enable Real AI Agents With Gemini

```powershell
$env:GEMINI_API_KEY="your_key_here"
$env:PLACEAGENT_MODEL="gemini-2.5-flash"
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

## Core agents

- `ScoutAgent`: parses resumes and detects strengths and gaps
- `MatcherAgent`: scores company and role fit
- `PlannerAgent`: generates preparation plans and task blueprints
- `MentorAgent`: powers the AI chat mentor
- `InterviewerAgent`: runs mock interview feedback loops
- `WatchdogAgent`: monitors readiness drops and raises alerts
- `InsightAgent`: generates analytics and HR shortlists

## Current app routes

- `/` landing page
- `/student` student dashboard
- `/tpc` TPC dashboard
- `/hr` company HR portal

## Notes

- Gemini calls are made server-side.
- Data is currently in-memory for hackathon speed.
- The next production step is persistence with Supabase/Auth/Storage plus async jobs.
