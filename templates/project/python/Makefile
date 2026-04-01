.PHONY: install test migrate run

install:
	python3 -m venv .venv
	.venv/bin/pip install -r requirements.txt

test:
	. .env 2>/dev/null; .venv/bin/pytest

migrate:
	. .env 2>/dev/null; .venv/bin/alembic upgrade head

run:
	. .env 2>/dev/null; .venv/bin/uvicorn app.main:app --reload
