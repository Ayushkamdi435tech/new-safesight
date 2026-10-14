# SafeSight starter

Separate Citizen Panel and Rescue/Admin Dashboard using HTML/CSS/JS, Python FastAPI, Neon PostgreSQL, and a pretrained YOLO object detector.

## Important AI limitation
The default `yolo11n.pt` is a general COCO object detector. It can detect classes it was trained on (such as people and vehicles), but it does NOT by itself detect flood severity, fire, landslides, or trapped people. A disaster-specific model and evaluation are needed for those tasks. AI output is decision support only.

## Setup (Windows)
1. Install Python 3.10+.
2. Open a terminal in this folder:
   ```powershell
   cd backend
   python -m venv venv
   .\venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   copy .env.example .env
   ```
   If PowerShell blocks activation, use Command Prompt and run `venv\Scripts\activate.bat`.
3. Create a Neon PostgreSQL database at https://neon.tech and paste its connection string into `backend/.env` as `DATABASE_URL=postgresql+psycopg://...`. Keep `.env` private.
4. Set a long random `ADMIN_API_KEY` in `.env`.
5. Start API: `uvicorn main:app --reload`
6. Open http://127.0.0.1:8000/docs
7. Open `frontend/index.html` using VS Code Live Server. Default API address is `http://127.0.0.1:8000`.

The API starts without a database URL, but report endpoints require Neon configuration. First AI request may download model weights and take a while. Use only test/sample images during development.

## API
- `GET /health`
- `POST /api/reports`
- `GET /api/reports` (admin key required)
- `PATCH /api/reports/{public_id}/status` (admin key required)
- `POST /api/analyze-image`

This is a prototype, not a live emergency dispatch service. Before public deployment, implement proper user accounts, secure sessions, upload storage, rate limits, audit logs, and restricted CORS.
