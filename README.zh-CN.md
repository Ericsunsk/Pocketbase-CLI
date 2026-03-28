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

## 项目定位

`pocketbase-cli` 基于 PocketBase HTTP API 提供统一的远程命令面，覆盖认证、settings、logs、crons、collections、records、files、backups 和原始 HTTP 请求等常见操作。

相比直接拼 HTTP 请求，它额外提供：

- 面向自动化的稳定 JSON Envelope
- 面向工具和 LLM Agent 的命令发现能力
- 更适合 Shell 和 Pipeline 的 stdin-first JSON 输入方式
- 在真正调用前先做状态校验的 `preflight`
- 对破坏性操作更明确的确认护栏
- 适合运维排障的 REPL 工作流

## 核心能力

- 面向已部署 PocketBase 的 Remote-first 管理能力
- 稳定的 `--json` 输出，包含 `meta`、`result`、`error`、`http`、`pagination`
- 可机读的 `schema --json` 命令契约
- 通过 `auth login-browser` 提供本地 loopback 浏览器登录
- 通过可重复的 `--binary-file` 直接上传文件
- 通过 `collections ensure` 做幂等集合编排
- 已保存的 auth、config、history 状态会加密持久化
- 通过显式 `--yes` 保护破坏性或有副作用的操作

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

如果后续发布到 npm，并且你希望在仓库之外直接使用命令：

```sh
npm i -g pocketbase-cli
```

## 快速开始

```sh
node dist/bin.js config set base_url https://pb.example.com

printf 'Secret123\n' | node dist/bin.js auth login --password-stdin admin@example.com
node dist/bin.js --json preflight --require-auth
node dist/bin.js --json info
node dist/bin.js schema --json
node dist/bin.js records list users --all
```

替代认证方式：

```sh
node dist/bin.js auth login-browser
# 无头环境：
node dist/bin.js auth login-browser --no-open
```

不带子命令直接运行会进入 REPL：

```sh
node dist/bin.js
```

## 命令分组

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

## 配置与状态

Base URL 解析优先级为：

`命令行参数 > 持久化 config > POCKETBASE_CLI_BASE_URL > 已保存登录态目标地址`

支持的环境变量：

- `POCKETBASE_CLI_BASE_URL`：默认远程目标地址
- `POCKETBASE_CLI_STATE_DIR`：覆盖本地状态目录

凭据输入方式：

- `auth login` 只从命令参数或 `--password-stdin` 读取凭据
- `auth login-browser` 提供本地浏览器表单，并支持无头环境使用 `--no-open`
- 不再支持从环境变量回退身份或密码

本地状态存储：

- history、config 和 auth 状态默认保存在 `~/.cache/pocketbase-cli`
- 持久化的 session 文件会加密落盘
- 相邻的 `session.json.key` 文件保存本地解密材料

## 行为说明

- 在 `--json` 模式下，`result` 表示解码后的业务结果；当命令直接代理 HTTP 响应时，`data` 会保留原始 transport wrapper。
- `raw` 默认按匿名请求发送；只有显式传入 `--with-auth` 才会附带已保存的远程 token。
- 当持久化的 `base_url` 或 `auth_collection` 与当前已保存登录态不匹配时，CLI 会自动清理该登录态。
- `preflight` 是只读命令，用来报告当前 config、auth 和 health 检查是否满足下一条远程命令的前置条件；如果 `base_url` 本身不合法，也会在发起远程探测前直接报错。
- `auth login-browser` 会在 `127.0.0.1` 上启动一个临时本地服务，凭据不会通过远程回调地址传输。

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
├── CHANGELOG.md
├── DEVELOPMENT.md
├── FEATURES.md
├── TESTING.md
├── package.json
├── src/
├── test/
└── dist/
```

## 文档导航

- [`README.md`](README.md)：双语入口页
- [`README.en.md`](README.en.md)：英文指南
- [`FEATURES.md`](FEATURES.md)：功能与行为参考
- [`DEVELOPMENT.md`](DEVELOPMENT.md)：开发与构建指南
- [`TESTING.md`](TESTING.md)：测试策略与验证说明
- [`CHANGELOG.md`](CHANGELOG.md)：发布说明
