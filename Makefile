.PHONY: run-server run-fe

run-server:
	cargo run

# `npm install` is idempotent and skips work when node_modules is current.
run-fe:
	cd web && npm install && npm run dev
