"""SQLAlchemy database engine and session, configured from environment variables."""

import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    os.getenv("SPRING_DATASOURCE_URL", "postgresql://localhost:5432/databricks_postgres").replace(
        "jdbc:postgresql://", "postgresql://"
    ),
)

# For Lakebase connections, ensure sslmode=require
if "sslmode" not in DATABASE_URL:
    DATABASE_URL += "?sslmode=require" if "?" not in DATABASE_URL else "&sslmode=require"

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
