import os
import secrets
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
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

    return {
    "message": "Login successful",
    "admin_key": os.getenv("ADMIN_API_KEY", "")
}

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5500",
        "http://localhost:5500",
        "http://127.0.0.1:5501",
        "http://localhost:5501"
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type", "X-Admin-Key"],
)

from routes.reports import router as reports_router
from routes.analysis import router as analysis_router

app.include_router(reports_router, prefix="/api")
app.include_router(analysis_router, prefix="/api")

from fastapi.responses import FileResponse
from fastapi import Header

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
            raise HTTPException(status_code=404, detail="Report not found")

        if not report.image_path:
            raise HTTPException(status_code=404, detail="No photo attached")

        image_path = Path(report.image_path).resolve()

        if not image_path.is_relative_to(UPLOAD_DIR):
            raise HTTPException(status_code=403, detail="Invalid photo path")

        if not image_path.is_file():
            raise HTTPException(status_code=404, detail="Photo file not found")

        suffix = image_path.suffix.lower()
        media_types = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
        }

        if suffix not in media_types:
            raise HTTPException(status_code=415, detail="Unsupported photo type")

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