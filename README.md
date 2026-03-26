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

## Quick Start

```sh
npm install
npm run build

node dist/bin.js config set base_url https://pb.example.com
node dist/bin.js config set auth_collection _superusers
printf 'Secret123\n' | node dist/bin.js auth login --password-stdin admin@example.com
node dist/bin.js --json info
```

## Language Guides

- [`English Guide`](README.en.md)
- [`中文指南`](README.zh-CN.md)
