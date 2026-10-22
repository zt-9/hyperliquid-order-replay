.DEFAULT_GOAL := start

.PHONY: start dev build install test check-node help

# One command for a fresh checkout: install, build, and serve the whole app.
start: build
	npm start

dev: install
	npm run dev

build: install
	npm run build

install: node_modules/.package-lock.json

node_modules/.package-lock.json: package.json package-lock.json | check-node
	npm ci --include=dev

check-node:
	@node -e 'if (Number(process.versions.node.split(".")[0]) < 24) { console.error("Node.js 24+ is required."); process.exit(1); }'

test: install
	npm test

help:
	@echo "make start  Install dependencies, build, and run at http://127.0.0.1:3001"
	@echo "make dev    Start the API and frontend with live reload at http://127.0.0.1:5173"
	@echo "make build  Build the app without starting it"
	@echo "make test   Run the test suite"
