# PocketBase CLI

[![Node.js 20+](https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Remote Only](https://img.shields.io/badge/mode-remote--only-0A7EA4)](README.en.md)
[![JSON + Schema](https://img.shields.io/badge/output-JSON%20%2B%20schema-1F6FEB)](README.en.md)
[![Last Commit](https://img.shields.io/github/last-commit/Ericsunsk/Pocketbase-CLI)](https://github.com/Ericsunsk/Pocketbase-CLI/commits/main)
[![GitHub Stars](https://img.shields.io/github/stars/Ericsunsk/Pocketbase-CLI?style=social)](https://github.com/Ericsunsk/Pocketbase-CLI/stargazers)

Standalone remote CLI for deployed [PocketBase](https://github.com/pocketbase/pocketbase) instances.

[`English`](README.en.md) | [`简体中文`](README.zh-CN.md)

## Overview

PocketBase CLI provides a consistent command surface for remote administration, scripting, and agent-driven workflows.

- Remote-first operations for deployed PocketBase instances
- Stable `--json` output for scripts and integrations
- Machine-readable `schema --json` command contract for tools and LLM agents
- REPL mode for iterative operator workflows
- Explicit `--yes` guardrails for destructive commands

## Documentation

- [`README.en.md`](README.en.md): full English overview
- [`README.zh-CN.md`](README.zh-CN.md): 完整中文说明
- [`FEATURES.md`](FEATURES.md): feature scope and behavior notes
- [`DEVELOPMENT.md`](DEVELOPMENT.md): development notes
- [`TESTING.md`](TESTING.md): validation commands and test coverage
- [`CHANGELOG.md`](CHANGELOG.md): release notes and notable changes

## Quick Start

```sh
npm install
npm run build

cp .env.example .env
# edit .env and set POCKETBASE_CLI_BASE_URL

printf 'Secret123\n' | node dist/bin.js auth login --password-stdin admin@example.com
node dist/bin.js --json info
```

`.env` can also hold the default auth settings used by `auth login`:

```env
POCKETBASE_CLI_BASE_URL=https://pb.example.com
POCKETBASE_CLI_AUTH_IDENTITY=admin@example.com
POCKETBASE_CLI_AUTH_PASSWORD=Secret123
```

Then you can run:

```sh
node dist/bin.js auth login
```

Priority remains: command-line args > persisted `config set ...` values > `.env` defaults > saved auth target.

## Automation

- `CI` runs on pushes and pull requests targeting `main`
- `Release` runs when a `v*.*.*` tag is pushed and publishes a GitHub Release with the packaged `.tgz` artifact
- `Release` can also be triggered manually for an existing tag through `workflow_dispatch`

## Language Guides

- [`English Guide`](README.en.md)
- [`中文指南`](README.zh-CN.md)
