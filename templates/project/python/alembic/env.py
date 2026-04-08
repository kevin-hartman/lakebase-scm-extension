"""Alembic environment configuration. Reads DATABASE_URL from environment."""

import os
from logging.config import fileConfig
from alembic import context
from sqlalchemy import engine_from_config, pool
from app.database import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# Read database URL from environment (same as app/database.py)
db_url = os.getenv(
    "DATABASE_URL",
    os.getenv("SPRING_DATASOURCE_URL", "postgresql://localhost:5432/databricks_postgres").replace(
        "jdbc:postgresql://", "postgresql://"
    ),
)

# Use psycopg v3 driver
if db_url.startswith("postgresql://"):
    db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)

if "sslmode" not in db_url:
    db_url += "?sslmode=require" if "?" not in db_url else "&sslmode=require"

config.set_main_option("sqlalchemy.url", db_url)


def run_migrations_offline():
    context.configure(url=db_url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
