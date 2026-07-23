.PHONY: up down build migrate logs test seed-check

build:
	docker compose build backend migrate

up: build
	docker compose up -d postgres redis
	docker compose run --rm migrate alembic upgrade head
	docker compose up -d backend

down:
	docker compose down

logs:
	docker compose logs -f backend

migrate:
	docker compose build backend migrate
	docker compose run --rm migrate alembic upgrade head

revision:
	docker compose build backend migrate
	docker compose run --name ccd-migrate-gen migrate alembic revision --autogenerate -m "$(MSG)"
	@echo "Copy the generated file out with: docker cp ccd-migrate-gen:/srv/apps/backend/alembic/versions/<file>.py apps/backend/alembic/versions/"
	@echo "Then: docker rm ccd-migrate-gen"

test:
	cd apps/backend && pip install -q -r requirements-dev.txt && pytest -q
