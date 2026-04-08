"""SQLAlchemy database engine and session, configured from environment variables."""

import os
from urllib.parse import quote_plus
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase


def _build_url() -> str:
    """Build database URL from DATABASE_URL or DB_* env vars."""
    # Prefer DATABASE_URL (postgresql:// with embedded credentials)
    url = os.getenv("DATABASE_URL")
    if url:
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+psycopg://", 1)
        if "sslmode" not in url:
            url += "?sslmode=require" if "?" not in url else "&sslmode=require"
        return url

    # Fallback: build from individual vars
    host = os.getenv("LAKEBASE_HOST", os.getenv("DB_HOST", "localhost"))
    port = os.getenv("DB_PORT", "5432")
    dbname = os.getenv("DB_NAME", "databricks_postgres")
    user = os.getenv("DB_USERNAME", "")
    password = os.getenv("DB_PASSWORD", "")

    if user and password:
        return f"postgresql+psycopg://{quote_plus(user)}:{quote_plus(password)}@{host}:{port}/{dbname}?sslmode=require"
    return f"postgresql+psycopg://{host}:{port}/{dbname}?sslmode=require"


DATABASE_URL = _build_url()
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
