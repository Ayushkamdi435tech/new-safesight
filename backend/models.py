
from datetime import datetime

from sqlalchemy import (
    String,
    Text,
    Float,
    Integer,
    Boolean,
    DateTime,
)
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(
        Integer, primary_key=True, index=True
    )

    public_id: Mapped[str] = mapped_column(
        String(20), unique=True, index=True
    )

    # Reporter contact details
    reporter_name: Mapped[str] = mapped_column(
        String(100), nullable=False
    )

    contact_number: Mapped[str] = mapped_column(
        String(25), nullable=False
    )

    # Incident details
    disaster_type: Mapped[str] = mapped_column(
        String(40), index=True
    )

    description: Mapped[str] = mapped_column(Text)

    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)

    people_trapped: Mapped[bool] = mapped_column(
        Boolean, default=False
    )

    people_affected: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )

    # Photo and AI information
    image_path: Mapped[str | None] = mapped_column(
        String(500), nullable=True
    )

    ai_summary: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )

    # Priority and status
    priority_score: Mapped[int] = mapped_column(
        Integer, default=0
    )

    priority: Mapped[str] = mapped_column(
        String(20), default="MEDIUM", index=True
    )

    status: Mapped[str] = mapped_column(
        String(30), default="PENDING_VERIFICATION", index=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, index=True
    )
