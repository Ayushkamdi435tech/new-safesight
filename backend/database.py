import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from dotenv import load_dotenv

load_dotenv()
engine = None
SessionLocal = None

class Base(DeclarativeBase):
    pass

def configure_database():
    global engine, SessionLocal
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        engine = None
        SessionLocal = None
        return
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    engine = create_engine(url, pool_pre_ping=True)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

def get_db():
    if SessionLocal is None:
        raise RuntimeError("DATABASE_URL is not configured in backend/.env")
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
