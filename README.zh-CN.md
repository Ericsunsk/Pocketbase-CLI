# PocketBase CLI

[![Node.js 20+](https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Remote Only](https://img.shields.io/badge/mode-remote--only-0A7EA4)](README.en.md)
[![JSON + Schema](https://img.shields.io/badge/output-JSON%20%2B%20schema-1F6FEB)](README.zh-CN.md)
[![Last Commit](https://img.shields.io/github/last-commit/Ericsunsk/Pocketbase-CLI)](https://github.com/Ericsunsk/Pocketbase-CLI/commits/main)
[![GitHub Stars](https://img.shields.io/github/stars/Ericsunsk/Pocketbase-CLI?style=social)](https://github.com/Ericsunsk/Pocketbase-CLI/stargazers)

面向已部署 [PocketBase](https://github.com/pocketbase/pocketbase) 实例的独立远程 CLI。

[`English`](README.en.md) | [`简体中文`](README.zh-CN.md)

## 项目速览

| 项目 | 说明 |
| --- | --- |
| 运行模式 | Remote-only |
| Runtime | Node.js 20+ |
| 交互方式 | CLI、REPL、`--json`、`schema --json` |
| 目标对象 | 已部署的 PocketBase 实例 |
| 典型场景 | 运维、自动化脚本、Agent Tooling |

## 为什么做这个项目

`pocketbase-cli` 基于 PocketBase HTTP API 提供了一套统一的远程管理命令面，覆盖 auth、settings、logs、crons、collections、records、files、backups 以及 raw request 等常见操作。

相比直接调用 HTTP API，这个项目额外提供了：

- 面向自动化的稳定 JSON Envelope
- 面向工具和 LLM Agent 的 `schema --json` 命令契约
- 更适合 Shell 和 Pipeline 的 stdin-first JSON 输入方式
- 适合运维排障的 REPL 工作流
- 对破坏性操作更明确的安全护栏

## 核心能力

- 面向已部署 PocketBase 的 Remote-first 管理能力
- 稳定的 `--json` 输出，包含 `meta`、`result`、`error`、`http`、`pagination`
- 可机读的 `schema --json` 命令发现能力
- 通过可重复的 `--binary-file` 直接上传文件
- 通过 `collections ensure` 做幂等集合编排
- 通过显式 `--yes` 保护破坏性操作

## 安装方式

### 本地开发

```sh
npm install
npm run build
```

在仓库内直接运行构建后的 CLI：

```sh
node dist/bin.js --help
```

### 全局安装

如果后续发布到 npm，并且你希望在仓库之外也能直接使用命令，可以这样安装：

```sh
npm i -g pocketbase-cli
```

## 快速开始

```sh
node dist/bin.js config set base_url https://pb.example.com
node dist/bin.js config set auth_collection _superusers
printf 'Secret123\n' | node dist/bin.js auth login --password-stdin admin@example.com
node dist/bin.js --json info
node dist/bin.js schema --json
node dist/bin.js records list users --all
```

不带子命令直接运行会进入 REPL：

```sh
node dist/bin.js
```

## 命令分组

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

## 能力边界

这个 CLI 是纯远程模式，不封装本地 PocketBase Binary。

它更适合：

- 通过 URL 可访问的已部署 PocketBase 实例
- Admin / Operator 工作流
- CI Job 和自动化维护脚本
- 需要结构化命令发现能力的 Agent Tooling

它不覆盖以下本地进程类命令：

- `serve`
- `migrate`
- `update`
- 本地 `superuser` CLI wrapper

## 项目结构

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

## 文档导航

- [`README.md`](README.md)：双语入口页
- [`README.en.md`](README.en.md)：英文说明
- [`FEATURES.md`](FEATURES.md)：功能范围与行为说明
- [`DEVELOPMENT.md`](DEVELOPMENT.md)：开发说明
- [`TESTING.md`](TESTING.md)：测试范围与验证命令
