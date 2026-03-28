# PocketBase CLI

[![Node.js 20+](https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Remote Only](https://img.shields.io/badge/mode-remote--only-0A7EA4)](README.en.md)
[![JSON + Schema](https://img.shields.io/badge/output-JSON%20%2B%20schema-1F6FEB)](README.en.md)
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

## Why This Project

`pocketbase-cli` wraps the PocketBase HTTP API behind a consistent, automation-friendly command surface for remote operations such as auth, settings, logs, crons, collections, records, files, backups, and raw requests.

Compared with calling the HTTP API directly, it adds:

- stable JSON envelopes for automation
- command schema discovery for tools and LLM agents
- stdin-first JSON input patterns
- REPL support for iterative operator workflows
- preflight readiness checks before a mutating or authenticated call
- explicit safety rails for destructive mutations

## Key Capabilities

- Remote-first administration for deployed PocketBase instances
- Stable `--json` responses with `meta`, `result`, `error`, `http`, and `pagination`
- Machine-readable `schema --json` contract for command discovery
- Schema entries enriched with parameter help, enum choices, conflicts, examples, and `input_schema`
- Direct file upload support with repeatable `--binary-file`
- Idempotent collection provisioning with `collections ensure`
- Guarded destructive operations via explicit `--yes`

## Installation

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
cp .env.example .env
# edit .env and set POCKETBASE_CLI_BASE_URL

printf 'Secret123\n' | node dist/bin.js auth login --password-stdin admin@example.com
node dist/bin.js --json preflight --require-auth
node dist/bin.js --json info
node dist/bin.js schema --json
node dist/bin.js records list users --all
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

Run without a subcommand to enter REPL mode:

```sh
node dist/bin.js
```

## Command Groups

- `info`
- `schema`
- `preflight`
- `auth login|logout|status|whoami|refresh`
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

## Behavior Notes

- In `--json` mode, `result` is the decoded business payload. `data` preserves the raw transport wrapper when the command proxies an HTTP response.
- `raw` requests are anonymous by default. Pass `--with-auth` to attach the saved remote auth token explicitly.
- Changing persisted `base_url` or `auth_collection` clears a saved auth session when it no longer matches the configured target.
- `preflight` is read-only and reports whether config, auth, and health checks are ready for the next remote command.

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
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── src/
├── test/
└── dist/
```

## Documentation

- [`README.md`](README.md): bilingual landing page
- [`README.zh-CN.md`](README.zh-CN.md): Chinese overview
- [`FEATURES.md`](FEATURES.md): feature scope and behavior notes
- [`DEVELOPMENT.md`](DEVELOPMENT.md): development notes
- [`TESTING.md`](TESTING.md): validation commands and test coverage
