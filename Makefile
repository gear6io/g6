.PHONY: run-server run-fe build-graph

run-server:
	GEAR6_DISABLE_AUTH=true cargo run

# `npm install` is idempotent and skips work when node_modules is current.
run-fe:
	GEAR6_DISABLE_AUTH=true GEAR6_CORS_ORIGIN=http://localhost:1420 cargo run
cd desktop && npm run dev

build-graph:
	.venv/bin/code-review-graph build   
