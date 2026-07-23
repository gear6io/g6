.PHONY: run-server run-fe build-graph

run-server:
	GEAR6_DISABLE_AUTH=true GEAR6_CORS_ORIGIN=http://localhost:1420 cargo run

# `npm install` is idempotent and skips work when node_modules is current.
run-fe:
	cd frontend && pnpm install && pnpm tauri dev

build-graph:
	.venv/bin/code-review-graph build   
