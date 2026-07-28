.DEFAULT_GOAL := help

.PHONY: help install run check test lint arch types eval db-up db-down migrate worker enqueue integration clean

help: ## Показать список задач
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Установить зависимости по локфайлу
	pnpm install --frozen-lockfile

run: ## Принять все источники и выгрузить catalog.json
	pnpm ingest && pnpm export

check: types lint arch test ## Всё, что гоняет CI, в том же порядке

types: ## Проверить типы во всём воркспейсе
	pnpm typecheck

lint: ## Линтер с проверкой типов
	pnpm lint

arch: ## Проверить правило зависимостей
	pnpm arch

test: ## Юнит, property, golden и тесты безопасности
	pnpm test

eval: ## Замерить вклад арбитра против базовой линии
	pnpm eval

db-up: ## Поднять PostgreSQL и дождаться готовности
	docker compose up -d --wait

db-down: ## Остановить PostgreSQL и удалить том
	docker compose down -v

migrate: ## Применить миграции
	pnpm db:migrate

worker: ## Запустить воркер pg-boss (Ctrl+C для остановки)
	pnpm worker

enqueue: ## Поставить задачу приёма в очередь
	pnpm ingest --store=postgres --enqueue

integration: ## Интеграционные тесты на одноразовом PostgreSQL (нужен Docker)
	pnpm test:integration

clean: ## Удалить артефакты прогонов
	rm -rf out catalog.json
