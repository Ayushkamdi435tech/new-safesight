
import os, uuid, secrets
from pathlib import Path
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from sqlalchemy.orm import Session
from sqlalchemy import select
from database import get_db
from models import Report
from schemas import ReportOut, StatusUpdate
from priority_engine import assess_priority


router = APIRouter(tags=["Reports"])
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_IMAGE_BYTES = 5 * 1024 * 1024

def require_admin(x_admin_key: str | None = Header(default=None)):
    expected = os.getenv("ADMIN_API_KEY", "")
    if not expected or expected == "replace-this-with-a-long-random-secret":
        raise HTTPException(status_code=503, detail="Set a private ADMIN_API_KEY in backend/.env first")
    if x_admin_key != expected:
        raise HTTPException(status_code=401, detail="Admin authorization required")

def save_image(image):
    if image is None or not image.filename:
        return None
    if image.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Only JPG, PNG or WEBP images are accepted")
    data = image.file.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image must be 5 MB or smaller")
    if not data:
        raise HTTPException(status_code=400, detail="Image is empty")
    suffix = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[image.content_type]
    folder = Path(os.getenv("UPLOAD_DIR", "uploads"))
    folder.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}{suffix}"
    (folder / name).write_bytes(data)
    return str(folder / name)

@router.post("/reports", response_model=ReportOut)
def create_report(
    disaster_type: str = Form(...), description: str = Form(...),
    latitude: float = Form(...), longitude: float = Form(...),
    people_trapped: bool = Form(False), people_affected: int | None = Form(None),
    image: UploadFile | None = File(None), db: Session = Depends(get_db)
):
    if disaster_type not in {
    "Flood",
    "Fire",
    "Earthquake",
    "Landslide",
    "Cyclone",
    "Building Collapse",
    "Road Accident",
    "Road Blockage",
    "Other"
}:
        raise HTTPException(status_code=400, detail="Invalid disaster type")
    if not description.strip() or len(description) > 3000:
        raise HTTPException(status_code=400, detail="Description is required (max 3000 characters)")
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        raise HTTPException(status_code=400, detail="Invalid coordinates")
    if people_affected is not None and not (0 <= people_affected <= 1000000):
        raise HTTPException(status_code=400, detail="Invalid affected people count")
    image_path = save_image(image)
    score, priority = assess_priority(disaster_type, people_trapped, people_affected, description)
    report = Report(
        public_id=f"SS-{uuid.uuid4().hex[:8].upper()}",
        disaster_type=disaster_type, description=description.strip(),
        latitude=latitude, longitude=longitude, people_trapped=people_trapped,
        people_affected=people_affected, image_path=image_path,
        priority_score=score, priority=priority, status="PENDING_VERIFICATION"
    )
    db.add(report); db.commit(); db.refresh(report)
    return report

@router.get("/reports", response_model=list[ReportOut], dependencies=[Depends(require_admin)])
def list_reports(db: Session = Depends(get_db), status: str | None = None, priority: str | None = None):
    query = select(Report).order_by(Report.created_at.desc())
    if status: query = query.where(Report.status == status)
    if priority: query = query.where(Report.priority == priority.upper())
    return list(db.scalars(query).all())

@router.get("/reports/{public_id}", response_model=ReportOut, dependencies=[Depends(require_admin)])
def get_report(public_id: str, db: Session = Depends(get_db)):
    report = db.scalar(select(Report).where(Report.public_id == public_id))
    if not report: raise HTTPException(status_code=404, detail="Report not found")
    return report

@router.patch("/reports/{public_id}/status", response_model=ReportOut, dependencies=[Depends(require_admin)])
def update_status(public_id: str, payload: StatusUpdate, db: Session = Depends(get_db)):
    report = db.scalar(select(Report).where(Report.public_id == public_id))
    if not report: raise HTTPException(status_code=404, detail="Report not found")
    report.status = payload.status
    db.commit(); db.refresh(report)
    return report
