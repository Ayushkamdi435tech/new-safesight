import os
import secrets
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from dotenv import load_dotenv
import json
import urllib.request
import urllib.error

from database import Base, configure_database
from models import Report

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_database()

    from database import engine as configured_engine

    if configured_engine is not None:
        Base.metadata.create_all(bind=configured_engine)

    Path(os.getenv("UPLOAD_DIR", "uploads")).mkdir(
        parents=True, exist_ok=True
    )

    yield


app = FastAPI(
    title="SafeSight API",
    description="Citizen disaster reporting and rescue coordination prototype",
    lifespan=lifespan
)


# CORS configuration
app.add_middleware(
    CORSMiddleware,
    
allow_origins=[
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://127.0.0.1:5501",
    "http://localhost:5501",
    "https://safesight-frontend.vercel.app",
],

    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type", "X-Admin-Key"],
)


class AdminLoginRequest(BaseModel):
    username: str
    password: str


@app.post("/api/admin/login")
def admin_login(payload: AdminLoginRequest):
    expected_username = os.getenv("ADMIN_USERNAME", "")
    expected_password = os.getenv("ADMIN_PASSWORD", "")

    if not expected_username or not expected_password:
        raise HTTPException(
            status_code=503,
            detail="Admin credentials are not configured"
        )

    username_ok = secrets.compare_digest(
        payload.username, expected_username
    )
    password_ok = secrets.compare_digest(
        payload.password, expected_password
    )

    if not (username_ok and password_ok):
        raise HTTPException(
            status_code=401,
            detail="Invalid username or password"
        )

    admin_key = os.getenv("ADMIN_API_KEY", "")

    if not admin_key:
        raise HTTPException(
            status_code=503,
            detail="Admin API key is not configured"
        )

    return {
        "message": "Login successful",
        "admin_key": admin_key
    }


from routes.reports import router as reports_router
from routes.analysis import router as analysis_router

app.include_router(reports_router, prefix="/api")
app.include_router(analysis_router, prefix="/api")


UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "uploads")).resolve()


@app.get("/api/reports/{public_id}/photo")
def get_report_photo(
    public_id: str,
    x_admin_key: str | None = Header(default=None),
):
    expected_key = os.getenv("ADMIN_API_KEY", "")

    if not expected_key or not secrets.compare_digest(
        x_admin_key or "", expected_key
    ):
        raise HTTPException(
            status_code=401,
            detail="Admin authorization required",
        )

    from sqlalchemy import select
    from database import SessionLocal

    if SessionLocal is None:
        raise HTTPException(
            status_code=503,
            detail="Database is not configured",
        )

    with SessionLocal() as db:
        report = db.scalar(
            select(Report).where(Report.public_id == public_id)
        )

        if report is None:
            raise HTTPException(
                status_code=404,
                detail="Report not found"
            )

        if not report.image_path:
            raise HTTPException(
                status_code=404,
                detail="No photo attached"
            )

        image_path = Path(report.image_path).resolve()

        if not image_path.is_relative_to(UPLOAD_DIR):
            raise HTTPException(
                status_code=403,
                detail="Invalid photo path"
            )

        if not image_path.is_file():
            raise HTTPException(
                status_code=404,
                detail="Photo file not found"
            )

        suffix = image_path.suffix.lower()

        media_types = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
        }

        if suffix not in media_types:
            raise HTTPException(
                status_code=415,
                detail="Unsupported photo type"
            )

        return FileResponse(
            image_path,
            media_type=media_types[suffix],
        )


@app.get("/")
def home():
    return {
        "project": "SafeSight",
        "message": "Backend is running"
    }


@app.get("/health")
def health():
    from database import SessionLocal

    return {
        "status": "healthy",
        "database_configured": SessionLocal is not None
    }


class AIReportRequest(BaseModel):
    disaster_type: str
    description: str = Field(min_length=5, max_length=3000)
    people_trapped: bool = False
    people_affected: int | None = Field(default=None, ge=0)


@app.post("/api/ai/analyze-report")
def analyze_report(payload: AIReportRequest):
    ollama_url = os.getenv(
        "OLLAMA_URL", "http://127.0.0.1:11434"
    ).rstrip("/")

    prompt = f"""
You are assisting a disaster-response reporting prototype.
Analyze this citizen report:
Disaster type: {payload.disaster_type}
Description: {payload.description}
People trapped (citizen-reported): {payload.people_trapped}
People affected (citizen-reported): {payload.people_affected}

Return JSON with these keys:
emergency_indicators: list of short strings
summary: short factual summary
recommended_checks: list of items for a human responder to verify
uncertainties: list of missing or unverified information

Do not invent facts or claim the report is verified.
Do not decide actual dispatch priority. Human verification is required.
"""

    body = json.dumps({
        "model": "llama3.2:1b",
        "prompt": prompt,
        "stream": False,
        "format": "json"
    }).encode("utf-8")

    request = urllib.request.Request(
        f"{ollama_url}/api/generate",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            result = json.loads(response.read().decode("utf-8"))

        analysis = json.loads(result["response"])

        return {
            "model": "llama3.2:1b",
            "analysis": analysis,
            "human_verification_required": True
        }

    except urllib.error.URLError:
        raise HTTPException(
            status_code=503,
            detail="Cannot reach Ollama. Ensure Ollama is running on this computer."
        )

    except (KeyError, ValueError, TimeoutError):
        raise HTTPException(
            status_code=502,
            detail="AI response could not be processed. Try again."
        )
    
