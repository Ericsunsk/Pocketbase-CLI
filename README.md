# PocketBase CLI

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
- [`pocketbase_cli/README.md`](pocketbase_cli/README.md): detailed command reference and examples
- [`FEATURES.md`](FEATURES.md): feature scope and behavior notes
- [`DEVELOPMENT.md`](DEVELOPMENT.md): development notes
- [`TESTING.md`](TESTING.md): validation commands and test coverage

## Quick Start

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e .

pocketbase-cli config set base_url https://pb.example.com
pocketbase-cli config set auth_collection _superusers
printf 'Secret123\n' | pocketbase-cli auth login --password-stdin admin@example.com
pocketbase-cli --json info
```

## Language Guides

- [`English Guide`](README.en.md)
- [`中文指南`](README.zh-CN.md)
