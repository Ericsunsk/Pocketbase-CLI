# PocketBase CLI

[![Node.js 20+](https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Remote Only](https://img.shields.io/badge/mode-remote--only-0A7EA4)](README.en.md)
[![JSON + Schema](https://img.shields.io/badge/output-JSON%20%2B%20schema-1F6FEB)](README.en.md)
[![Latest Release](https://img.shields.io/github/v/release/Ericsunsk/Pocketbase-CLI)](https://github.com/Ericsunsk/Pocketbase-CLI/releases/latest)
[![Last Commit](https://img.shields.io/github/last-commit/Ericsunsk/Pocketbase-CLI)](https://github.com/Ericsunsk/Pocketbase-CLI/commits/main)
[![GitHub Stars](https://img.shields.io/github/stars/Ericsunsk/Pocketbase-CLI?style=social)](https://github.com/Ericsunsk/Pocketbase-CLI/stargazers)

Standalone remote CLI for deployed [PocketBase](https://github.com/pocketbase/pocketbase) instances.

[`English`](README.en.md) | [`简体中文`](README.zh-CN.md)

## Overview

PocketBase CLI provides a consistent command surface for remote administration, automation, and agent-driven workflows. It wraps the PocketBase HTTP API with stable command semantics, explicit confirmation guards, and machine-readable output designed for scripts and tools.

## Highlights

- Remote-first administration for deployed PocketBase instances
- Stable `--json` output for automation and integrations
- Machine-readable `schema --json` command contract
- Browser-assisted login with `auth login-browser`
- Encrypted local persistence for stored auth, config, and command history
- Explicit `--yes` guardrails for destructive or side-effectful operations

## Quick Start

One-line install or update from GitHub:

```sh
curl -fsSL https://raw.githubusercontent.com/Ericsunsk/Pocketbase-CLI/main/scripts/install-global.sh | bash
```

The installer clones or updates the repo under `~/.local/share/pocketbase-cli`, builds it, installs the global `pocketbase-cli` command, and prints a PATH hint when needed.

## Uninstall

```sh
npm uninstall -g pocketbase-cli --prefix "$(npm prefix -g)" && rm -rf ~/.local/share/pocketbase-cli ~/.cache/pocketbase-cli
```

```sh
npm install
npm run build

node dist/bin.js config set base_url https://pb.example.com

printf 'Secret123\n' | node dist/bin.js auth login --password-stdin admin@example.com
node dist/bin.js --json info
```

Alternative authentication flow:

```sh
node dist/bin.js auth login-browser
# headless hosts:
node dist/bin.js auth login-browser --no-open
```

Base URL resolution priority is: command-line arguments > persisted `config set ...` values > `POCKETBASE_CLI_BASE_URL` > stored auth session target.

Only the remote base URL is read from the environment. Login identity and password must come from command arguments, `--password-stdin`, or the local browser form.

By default the CLI stores config, history, and auth state under `~/.cache/pocketbase-cli`. The persisted session file is encrypted at rest and uses an adjacent `.key` file.

## Documentation

- [`README.en.md`](README.en.md): full English guide
- [`README.zh-CN.md`](README.zh-CN.md): 完整中文指南
- [`FEATURES.md`](FEATURES.md): feature and behavior reference
- [`DEVELOPMENT.md`](DEVELOPMENT.md): contributor and build guide
- [`TESTING.md`](TESTING.md): test strategy and validation guide
- [`CHANGELOG.md`](CHANGELOG.md): release notes
- [`docs/releases/v0.1.5.md`](docs/releases/v0.1.5.md): latest release summary
