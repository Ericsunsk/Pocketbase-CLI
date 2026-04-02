<p align="center">
  <img src="https://raw.githubusercontent.com/pocketbase/pocketbase/master/ui/dist/images/logo.svg" alt="PocketBase" width="64" />
</p>

<h1 align="center">PocketBase CLI</h1>

<p align="center">
  Remote-first command-line client for deployed <a href="https://github.com/pocketbase/pocketbase">PocketBase</a> instances.
</p>

<p align="center">
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white" alt="Node.js 20+" /></a>
  <a href="https://github.com/Ericsunsk/Pocketbase-CLI/releases/latest"><img src="https://img.shields.io/github/v/release/Ericsunsk/Pocketbase-CLI" alt="Latest Release" /></a>
  <a href="https://github.com/Ericsunsk/Pocketbase-CLI/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
  <a href="https://github.com/Ericsunsk/Pocketbase-CLI/stargazers"><img src="https://img.shields.io/github/stars/Ericsunsk/Pocketbase-CLI?style=social" alt="GitHub Stars" /></a>
</p>

<p align="center">
  <a href="README.en.md">English</a>&nbsp;&nbsp;|&nbsp;&nbsp;<a href="README.zh-CN.md">简体中文</a>
</p>

---

## Why PocketBase CLI

`pocketbase-cli` wraps the PocketBase HTTP API behind a consistent, automation-friendly command surface. Instead of assembling raw HTTP requests, you get:

- **Stable JSON envelopes** &mdash; predictable `meta`, `result`, `error`, `http`, `pagination` for every command
- **Schema discovery** &mdash; `schema --json` exposes a machine-readable contract for LLM agents and tools
- **Preflight checks** &mdash; validate config, auth, and server health before mutating calls
- **Safety rails** &mdash; destructive operations require `--yes`; secrets are redacted by default
- **REPL** &mdash; interactive session with history, undo/redo, and the same JSON contract

## Features

- **Remote-only** &mdash; manage deployed PocketBase over its HTTP API, no local binary required
- **Browser login** &mdash; local loopback form via `auth login`, with `--no-open` for headless environments
- **Encrypted state** &mdash; auth tokens, config, and command history encrypted at rest
- **File uploads** &mdash; repeatable `--binary-file` for record attachments and backup uploads
- **Idempotent provisioning** &mdash; `collections ensure` for safe create-or-update workflows
- **Full CRUD + auth flows** &mdash; records, collections, files, backups, settings, logs, crons, batch

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/Ericsunsk/Pocketbase-CLI/main/scripts/install-global.sh | bash
```

> Requires **Node.js 20+**, `git`, and `npm`.  
> Installs the global `pocketbase-cli` command under `~/.local/share/pocketbase-cli`.

<details>
<summary>Other installation methods</summary>

**From source:**

```sh
git clone https://github.com/Ericsunsk/Pocketbase-CLI.git
cd Pocketbase-CLI
npm install && npm run build
node dist/bin.js --help
```

**Global via npm** (after publishing):

```sh
npm i -g pocketbase-cli
```

**Uninstall:**

```sh
npm uninstall -g pocketbase-cli --prefix "$(npm prefix -g)" && rm -rf ~/.local/share/pocketbase-cli ~/.cache/pocketbase-cli
```

</details>

## Quick Start

```sh
# 1. Point to your PocketBase instance
pocketbase-cli config set base_url https://pb.example.com

# 2. Authenticate (opens a local browser login form)
pocketbase-cli auth login
# headless environments:
pocketbase-cli auth login --no-open

# 3. Verify the connection
pocketbase-cli preflight --require-auth

# 4. Start working
pocketbase-cli --json info
pocketbase-cli records list users --all
pocketbase-cli collections list
```

Enter REPL mode for interactive exploration:

```sh
pocketbase-cli repl
```

## Commands

| Group | Subcommands |
| :--- | :--- |
| **auth** | `login` `logout` `status` `whoami` `refresh` |
| **collections** | `list` `get` `create` `update` `ensure` `delete` `truncate` `import` `scaffolds` |
| **records** | `list` `get` `create` `update` `delete` `find` `upsert` `delete-by-filter` |
| **records** (auth) | `auth-methods` `auth-password` `auth-oauth2` `auth-refresh` `request-otp` `auth-otp` `request-password-reset` `confirm-password-reset` `request-verification` `confirm-verification` `request-email-change` `confirm-email-change` `impersonate` |
| **files** | `token` `url` |
| **backups** | `list` `create` `upload` `delete` `download` `restore` |
| **settings** | `get` `patch` `test-s3` `test-email` `apple-client-secret` |
| **logs** | `list` `get` `stats` |
| **crons** | `list` `run` |
| **batch** | `run` |
| **raw** | `<METHOD> <PATH>` &mdash; arbitrary HTTP with optional `--with-auth` |
| **utilities** | `info` `schema` `preflight` `config` `history` `undo` `redo` `repl` |

## Configuration

### Base URL Resolution

Priority (highest to lowest):

```
--base-url flag  >  config set base_url  >  POCKETBASE_CLI_BASE_URL env  >  stored auth target
```

### Environment Variables

| Variable | Purpose |
| :--- | :--- |
| `POCKETBASE_CLI_BASE_URL` | Default remote target URL |
| `POCKETBASE_CLI_STATE_DIR` | Override the local state directory (default: `~/.cache/pocketbase-cli`) |

### Session Storage

- Config, history, and auth state are stored under `~/.cache/pocketbase-cli`
- The session file is **encrypted at rest** with a sibling `.key` file
- Changing `base_url` or `auth_collection` automatically clears mismatched auth state

## Security

- Sensitive fields (tokens, passwords, signed URLs) are **redacted by default** in all output
- `files token` and `files url` require explicit `--reveal-token` to print secrets
- `raw` requests are anonymous unless `--with-auth` is explicitly passed
- `auth login` uses a temporary local server on `127.0.0.1` &mdash; credentials never leave the machine
- Destructive operations (`delete`, `truncate`, `restore`) require `--yes` confirmation

## Scope

This CLI is intentionally **remote-only**. It does not wrap the local PocketBase binary.

**Best for:** deployed instances reachable by URL, admin/operator workflows, CI/CD pipelines, agent-driven tooling.

**Not covered:** `serve`, `migrate`, `update`, or local superuser bootstrap.

## Documentation

| | |
| :--- | :--- |
| [Features](FEATURES.md) | Feature and behavior reference |
| [Development](DEVELOPMENT.md) | Contributor and build guide |
| [Testing](TESTING.md) | Test strategy and validation |
| [Changelog](CHANGELOG.md) | Release notes |

## License

[MIT](LICENSE)
