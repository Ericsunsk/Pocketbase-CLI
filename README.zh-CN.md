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
- 在真正调用前先做状态校验的 `preflight`
- 对破坏性操作更明确的安全护栏

## 核心能力

- 面向已部署 PocketBase 的 Remote-first 管理能力
- 稳定的 `--json` 输出，包含 `meta`、`result`、`error`、`http`、`pagination`
- 可机读的 `schema --json` 命令发现能力
- 更丰富的 schema 元数据，包括参数说明、枚举值、互斥关系、示例和 `input_schema`
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
cp .env.example .env
# 编辑 .env，填写 POCKETBASE_CLI_BASE_URL

printf 'Secret123\n' | node dist/bin.js auth login --password-stdin admin@example.com
node dist/bin.js --json preflight --require-auth
node dist/bin.js --json info
node dist/bin.js schema --json
node dist/bin.js records list users --all
```

`.env` 也可以放 `auth login` 需要的默认认证信息：

```env
POCKETBASE_CLI_BASE_URL=https://pb.example.com
POCKETBASE_CLI_AUTH_IDENTITY=admin@example.com
POCKETBASE_CLI_AUTH_PASSWORD=Secret123
```

然后可以直接执行：

```sh
node dist/bin.js auth login
```

优先级保持为：命令行参数 > 持久化 `config set ...` > `.env` 默认值 > 已保存登录态目标。

不带子命令直接运行会进入 REPL：

```sh
node dist/bin.js
```

## 命令分组

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

## 行为说明

- 在 `--json` 模式下，`result` 表示解码后的业务结果；当命令直接代理 HTTP 响应时，`data` 会保留原始 transport wrapper。
- `raw` 默认按匿名请求发送，不会自动附带已保存的 token；只有显式传入 `--with-auth` 才会附带远程登录态。
- 当持久化的 `base_url` 或 `auth_collection` 与当前已保存登录态不再匹配时，CLI 会自动清理该登录态。
- `preflight` 是只读命令，用来报告当前 config、auth 和 health 检查是否满足下一条远程命令的前置条件。

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
