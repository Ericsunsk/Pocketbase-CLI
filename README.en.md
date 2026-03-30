# PocketBase CLI

[![Node.js 20+](https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Remote Only](https://img.shields.io/badge/mode-remote--only-0A7EA4)](README.en.md)
[![JSON + Schema](https://img.shields.io/badge/output-JSON%20%2B%20schema-1F6FEB)](README.en.md)
[![Latest Release](https://img.shields.io/github/v/release/Ericsunsk/Pocketbase-CLI)](https://github.com/Ericsunsk/Pocketbase-CLI/releases/latest)
[![Last Commit](https://img.shields.io/github/last-commit/Ericsunsk/Pocketbase-CLI)](https://github.com/Ericsunsk/Pocketbase-CLI/commits/main)
[![GitHub Stars](https://img.shields.io/github/stars/Ericsunsk/Pocketbase-CLI?style=social)](https://github.com/Ericsunsk/Pocketbase-CLI/stargazers)

Standalone remote CLI for deployed [PocketBase](https://github.com/pocketbase/pocketbase) instances.

[`English`](README.en.md) | [`简体中文`](README.zh-CN.md)

## At a Glance

| Item | Value |
| --- | --- |
| Mode | Remote-only |
| Runtime | Node.js 20+ |
| Interface | CLI, REPL, `--json`, `schema --json` |
| Target | Deployed PocketBase instances |
| Best for | operators, automation, agent tooling |

## Why PocketBase CLI

`pocketbase-cli` wraps the PocketBase HTTP API behind a consistent command surface for remote operations such as authentication, settings, logs, crons, collections, records, files, backups, and raw HTTP requests.

Compared with issuing HTTP calls directly, it adds:

- stable JSON envelopes for automation
- command schema discovery for tools and LLM agents
- stdin-first JSON input patterns
- preflight readiness checks before authenticated or mutating calls
- explicit confirmation rails for destructive operations
- REPL support for iterative operator workflows

## Key Capabilities

- Remote-first administration for deployed PocketBase instances
- Stable `--json` responses with `meta`, `result`, `error`, `http`, and `pagination`
- Machine-readable `schema --json` contract for command discovery
- Browser-assisted login through a local loopback form with `auth login-browser`
- Direct file upload support with repeatable `--binary-file`
- Idempotent collection provisioning with `collections ensure`
- Encrypted session persistence at rest for stored auth, config, and history state
- Explicit `--yes` guardrails for destructive or side-effectful operations

## Installation

### One-line Install or Update

Requirements:

- Node.js 20+
- `git`
- `npm`

```sh
curl -fsSL https://raw.githubusercontent.com/Ericsunsk/Pocketbase-CLI/main/scripts/install-global.sh | bash
```

What the script does:

- clones or updates the repository under `~/.local/share/pocketbase-cli`
- installs dependencies and builds the CLI
- installs the global `pocketbase-cli` command
- prints a PATH hint if the global npm bin directory is not available in the current shell

The installed command name is `pocketbase-cli`, not `pocketbase`.

### Local Development

```sh
npm install
npm run build
```

Run the built CLI directly from the repository:

```sh
node dist/bin.js --help
```

### Global Install

Use this after publishing to npm if you want the command available outside the current repository:

```sh
npm i -g pocketbase-cli
```

## Quick Start

```sh
node dist/bin.js config set base_url https://pb.example.com

printf 'Secret123\n' | node dist/bin.js auth login --password-stdin admin@example.com
node dist/bin.js --json preflight --require-auth
node dist/bin.js --json info
node dist/bin.js schema --json
node dist/bin.js records list users --all
```

Alternative authentication flow:

```sh
node dist/bin.js auth login-browser
# headless hosts:
node dist/bin.js auth login-browser --no-open
```

Run without a subcommand to enter REPL mode:

```sh
node dist/bin.js
```

## Command Groups

- `info`
- `schema`
- `preflight`
- `auth login|login-browser|logout|status|whoami|refresh`
- `settings get|patch|test-s3|test-email|apple-client-secret`
- `logs list|get|stats`
- `crons list|run`
- `collections list|get|create|update|ensure|delete|truncate|import|scaffolds`
- `records auth-methods|auth-password|auth-oauth2|auth-refresh|request-otp|auth-otp|request-password-reset|confirm-password-reset|request-verification|confirm-verification|request-email-change|confirm-email-change|impersonate|list|get|create|update|delete|find|upsert|delete-by-filter`
- `batch run`
- `files token|url`
- `backups list|create|upload|delete|download|restore`
- `raw <METHOD> <PATH> [--with-auth]`
- `config show|set|unset`
- `undo`
- `redo`
- `history`
- `repl`

## Configuration and State

Base URL resolution priority is:

`command-line arguments > persisted config > POCKETBASE_CLI_BASE_URL > stored auth session target`

Supported environment variables:

- `POCKETBASE_CLI_BASE_URL`: default remote base URL
- `POCKETBASE_CLI_STATE_DIR`: override the local state directory

Credential handling:

- `auth login` reads credentials only from command arguments or `--password-stdin`
- `auth login-browser` provides a local browser form and supports `--no-open` for headless environments
- environment-based credential fallbacks are intentionally unsupported

Session storage:

- history, config, and auth state are stored under `~/.cache/pocketbase-cli` by default
- the persisted session file is encrypted at rest
- a neighboring `session.json.key` file stores local decryption material

## Behavior Notes

- In `--json` mode, `result` contains the decoded business payload. `data` preserves the raw transport wrapper when a command proxies an HTTP response.
- `raw` requests are anonymous by default. Pass `--with-auth` to attach the saved remote auth token explicitly.
- Secret-like fields in remote success and error output are redacted by default, including file tokens, signed URLs, passwords, and common API secret keys echoed by remote responses.
- `files token` and tokenized `files url` output are redacted by default. Use `files url --with-token --reveal-token` only when you intentionally need a signed URL or temporary token on stdout.
- Changing persisted `base_url` or `auth_collection` clears a stored auth session when it no longer matches the configured target.
- `preflight` is read-only and reports whether config, auth, and health checks are ready for the next remote command. It also surfaces invalid configured base URLs before probing the remote server.
- `auth login-browser` starts a temporary server on `127.0.0.1` and keeps credentials on the local machine.
- REPL history persistence now follows the same redaction rules as one-shot CLI execution, including tokenized `raw` request paths.

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
├── CHANGELOG.md
├── DEVELOPMENT.md
├── FEATURES.md
├── TESTING.md
├── package.json
├── src/
├── test/
└── dist/
```

## Documentation

- [`README.md`](README.md): bilingual landing page
- [`README.zh-CN.md`](README.zh-CN.md): Chinese guide
- [`FEATURES.md`](FEATURES.md): feature and behavior reference
- [`DEVELOPMENT.md`](DEVELOPMENT.md): contributor and build guide
- [`TESTING.md`](TESTING.md): test strategy and validation guide
- [`CHANGELOG.md`](CHANGELOG.md): release notes
- [`docs/releases/v0.1.4.md`](docs/releases/v0.1.4.md): latest release summary
