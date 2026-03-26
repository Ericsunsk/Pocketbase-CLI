# PocketBase CLI

Standalone remote CLI for deployed [PocketBase](https://github.com/pocketbase/pocketbase) instances.

It is designed for three kinds of usage at the same time:

- humans who want a practical admin CLI
- scripts that need stable `--json` output
- LLM agents that need a machine-readable `schema --json` contract

## Why This Project

`pocketbase-cli` wraps the PocketBase HTTP API behind a consistent command surface for remote operations such as auth, settings, logs, crons, collections, records, files, backups, and raw requests.

Compared with calling the HTTP API directly, this project adds:

- stable JSON envelopes for automation
- explicit safety rails for destructive commands
- stdin-first input patterns for JSON payloads
- REPL support for iterative operator workflows
- command schema discovery for tools and agent integrations

## Install

### Editable Local Install

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e .
```

### User-Level Install

Install from the repository path when you want the command available outside the current directory:

```sh
python3 -m pip install --user --break-system-packages .
```

If your shell cannot find the command, add one of these to `PATH`:

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

## Highlights

- Remote-first: targets deployed PocketBase instances instead of local process management
- Automation-friendly: stable `--json` responses with `meta`, `result`, `error`, `http`, and `pagination`
- Agent-friendly: `schema --json` exposes commands, arguments, options, examples, and safety metadata
- Safer mutations: destructive actions require explicit `--yes`
- Flexible input: supports `--file`, `--file -`, `--stdin-json`, and `--data`
- File workflows: supports direct record file upload via repeatable `--binary-file`

## Command Surface

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

This CLI is pure remote mode. It does not wrap the local PocketBase binary.

That means it is a good fit for:

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

## More Docs

- `pocketbase_cli/README.md`: full command reference and examples
- `FEATURES.md`: feature scope and behavioral notes
- `DEVELOPMENT.md`: development-oriented usage notes
- `TESTING.md`: validation commands and test coverage
