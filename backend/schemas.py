from pydantic import BaseModel, Field, ConfigDict
from datetime import datetime

class ReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    public_id: str
    disaster_type: str
    description: str
    latitude: float
    longitude: float
    people_trapped: bool
    people_affected: int | None
    image_path: str | None
    ai_summary: str | None
    priority_score: int
    priority: str
    status: str
    created_at: datetime

class StatusUpdate(BaseModel):
    status: str = Field(pattern="^(PENDING_VERIFICATION|VERIFIED|RESCUE_IN_PROGRESS|RESOLVED|REJECTED)$")
