# PocketBase CLI

Standalone remote CLI for deployed [PocketBase](https://github.com/pocketbase/pocketbase) instances.

[`English`](README.en.md) | [`简体中文`](README.zh-CN.md)

## At a Glance

| Item | Value |
| --- | --- |
| Mode | Remote-only |
| Runtime | Python 3.9+ |
| Interface | CLI, REPL, `--json`, `schema --json` |
| Target | Deployed PocketBase instances |
| Best for | operators, automation, agent tooling |

## Why This Project

`pocketbase-cli` wraps the PocketBase HTTP API behind a consistent, automation-friendly command surface for remote operations such as auth, settings, logs, crons, collections, records, files, backups, and raw requests.

Compared with calling the HTTP API directly, it adds:

- stable JSON envelopes for automation
- command schema discovery for tools and LLM agents
- stdin-first JSON input patterns
- REPL support for iterative operator workflows
- explicit safety rails for destructive mutations

## Key Capabilities

- Remote-first administration for deployed PocketBase instances
- Stable `--json` responses with `meta`, `result`, `error`, `http`, and `pagination`
- Machine-readable `schema --json` contract for command discovery
- Direct file upload support with repeatable `--binary-file`
- Idempotent collection provisioning with `collections ensure`
- Guarded destructive operations via explicit `--yes`

## Installation

### Editable Local Install

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e .
```

### User-Level Install

Use this when you want the command available outside the current repository:

```sh
python3 -m pip install --user --break-system-packages .
```

If your shell cannot find the command, add one of these directories to `PATH`:

- `$HOME/.local/bin`
- `$HOME/Library/Python/<python-version>/bin`

## Quick Start

```sh
pocketbase-cli config set base_url https://pb.example.com
pocketbase-cli config set auth_collection _superusers
printf 'Secret123\n' | pocketbase-cli auth login --password-stdin admin@example.com
pocketbase-cli --json info
pocketbase-cli schema --json
pocketbase-cli records list users --all
```

Run without a subcommand to enter REPL mode:

```sh
pocketbase-cli
```

## Command Groups

- `info`
- `schema`
- `auth login|logout|status|whoami|refresh`
- `settings get|patch|test-s3|test-email|apple-client-secret`
- `logs list|get|stats`
- `crons list|run`
- `collections list|get|create|update|ensure|delete|truncate|import|scaffolds`
- `records auth-methods|auth-password|auth-oauth2|auth-refresh|request-otp|auth-otp|request-password-reset|confirm-password-reset|request-verification|confirm-verification|request-email-change|confirm-email-change|impersonate|list|get|create|update|delete|find|upsert|delete-by-filter`
- `batch run`
- `files token|url`
- `backups list|create|upload|delete|download|restore`
- `raw <METHOD> <PATH>`
- `config show|set|unset`
- `undo`
- `redo`
- `history`
- `repl`

## Scope

This CLI is intentionally remote-only. It does not wrap the local PocketBase binary.

It is a good fit for:

- deployed PocketBase instances reachable by URL
- admin and operator workflows
- CI jobs and maintenance scripts
- agent-driven tooling that needs structured command discovery

It intentionally does not cover local process commands such as:

- `serve`
- `migrate`
- `update`
- local `superuser` CLI wrappers

## Project Layout

```text
pocketbase/
├── README.md
├── README.en.md
├── README.zh-CN.md
├── DEVELOPMENT.md
├── FEATURES.md
├── TESTING.md
├── setup.py
└── pocketbase_cli/
    ├── README.md
    ├── __init__.py
    ├── __main__.py
    ├── pocketbase_cli.py
    ├── core/
    ├── utils/
    └── tests/
```

## Documentation

- [`README.md`](README.md): bilingual landing page
- [`README.zh-CN.md`](README.zh-CN.md): Chinese overview
- [`pocketbase_cli/README.md`](pocketbase_cli/README.md): detailed command reference and examples
- [`FEATURES.md`](FEATURES.md): feature scope and behavior notes
- [`DEVELOPMENT.md`](DEVELOPMENT.md): development notes
- [`TESTING.md`](TESTING.md): validation commands and test coverage
