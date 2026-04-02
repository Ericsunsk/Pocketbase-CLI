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

## Features

- **Remote-only** &mdash; manage deployed PocketBase over its HTTP API, no local binary required
- **Structured output** &mdash; stable `--json` envelope with `meta`, `result`, `error`, `http`, `pagination`
- **Agent-friendly** &mdash; machine-readable `schema --json` for LLM agents and tool integrations
- **Browser login** &mdash; local loopback form via `auth login`, with `--no-open` for headless environments
- **Encrypted state** &mdash; auth tokens, config, and command history encrypted at rest
- **Safety rails** &mdash; destructive operations require explicit `--yes` confirmation

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/Ericsunsk/Pocketbase-CLI/main/scripts/install-global.sh | bash
```

> Requires Node.js 20+, git, and npm. Installs the global `pocketbase-cli` command.

<details>
<summary>Other installation methods</summary>

**From source:**

```sh
git clone https://github.com/Ericsunsk/Pocketbase-CLI.git
cd Pocketbase-CLI
npm install && npm run build
```

**Uninstall:**

```sh
npm uninstall -g pocketbase-cli --prefix "$(npm prefix -g)" && rm -rf ~/.local/share/pocketbase-cli ~/.cache/pocketbase-cli
```

</details>

## Quick Start

```sh
# Connect to your PocketBase instance
pocketbase-cli config set base_url https://pb.example.com

# Authenticate (opens browser login form)
pocketbase-cli auth login

# Verify connection
pocketbase-cli preflight --require-auth

# Start working
pocketbase-cli --json info
pocketbase-cli records list users --all
pocketbase-cli collections list
```

## Commands

| Group | Subcommands |
| --- | --- |
| **auth** | `login` `logout` `status` `whoami` `refresh` |
| **collections** | `list` `get` `create` `update` `ensure` `delete` `truncate` `import` `scaffolds` |
| **records** | `list` `get` `create` `update` `delete` `find` `upsert` `delete-by-filter` + auth flows |
| **files** | `token` `url` |
| **backups** | `list` `create` `upload` `delete` `download` `restore` |
| **settings** | `get` `patch` `test-s3` `test-email` `apple-client-secret` |
| **logs** | `list` `get` `stats` |
| **crons** | `list` `run` |
| **batch** | `run` |
| **raw** | `<METHOD> <PATH>` with optional `--with-auth` |
| **utilities** | `info` `schema` `preflight` `config` `history` `undo` `redo` `repl` |

## Documentation

| | |
| --- | --- |
| [English Guide](README.en.md) | Full usage and configuration reference |
| [中文指南](README.zh-CN.md) | 完整使用和配置参考 |
| [Features](FEATURES.md) | Feature and behavior reference |
| [Development](DEVELOPMENT.md) | Contributor and build guide |
| [Changelog](CHANGELOG.md) | Release notes |

## License

[MIT](LICENSE)
