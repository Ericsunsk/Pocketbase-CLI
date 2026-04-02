<p align="center">
  <img src="https://raw.githubusercontent.com/pocketbase/pocketbase/master/ui/dist/images/logo.svg" alt="PocketBase" width="64" />
</p>

<h1 align="center">PocketBase CLI</h1>

<p align="center">
  面向已部署 <a href="https://github.com/pocketbase/pocketbase">PocketBase</a> 实例的远程命令行客户端。
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

## 为什么用 PocketBase CLI

`pocketbase-cli` 把 PocketBase HTTP API 封装成统一的命令行接口。相比直接拼 HTTP 请求，你可以获得：

- **稳定的 JSON 输出** &mdash; 每个命令返回一致的 `meta`、`result`、`error`、`http`、`pagination` 信封
- **命令发现** &mdash; `schema --json` 输出可机读的命令契约，适合 LLM Agent 和自动化工具
- **Preflight 校验** &mdash; 在执行变更前检查 config、auth 和服务器健康状态
- **安全护栏** &mdash; 破坏性操作需要 `--yes` 确认；敏感信息默认脱敏
- **交互式 REPL** &mdash; 支持历史记录、undo/redo，使用与单次执行相同的 JSON 契约

## 核心能力

- **纯远程模式** &mdash; 通过 HTTP API 管理已部署的 PocketBase，无需本地二进制
- **浏览器登录** &mdash; `auth login` 打开本地 loopback 表单，`--no-open` 适配无头环境
- **加密持久化** &mdash; auth token、config、命令历史静态加密存储
- **文件上传** &mdash; 可重复 `--binary-file` 参数上传记录附件和备份
- **幂等编排** &mdash; `collections ensure` 安全实现 create-or-update
- **完整 CRUD + 认证流** &mdash; records、collections、files、backups、settings、logs、crons、batch

## 安装

```sh
curl -fsSL https://raw.githubusercontent.com/Ericsunsk/Pocketbase-CLI/main/scripts/install-global.sh | bash
```

> 前置要求：**Node.js 20+**、`git`、`npm`。  
> 安装后全局命令为 `pocketbase-cli`（不是 `pocketbase`）。

<details>
<summary>其他安装方式</summary>

**从源码构建：**

```sh
git clone https://github.com/Ericsunsk/Pocketbase-CLI.git
cd Pocketbase-CLI
npm install && npm run build
node dist/bin.js --help
```

**npm 全局安装**（发布到 npm 后）：

```sh
npm i -g pocketbase-cli
```

**卸载：**

```sh
npm uninstall -g pocketbase-cli --prefix "$(npm prefix -g)" && rm -rf ~/.local/share/pocketbase-cli ~/.cache/pocketbase-cli
```

</details>

## 快速开始

```sh
# 1. 配置目标实例
pocketbase-cli config set base_url https://pb.example.com

# 2. 认证（打开本地浏览器登录页）
pocketbase-cli auth login
# 无头环境：
pocketbase-cli auth login --no-open

# 3. 验证连接
pocketbase-cli preflight --require-auth

# 4. 开始工作
pocketbase-cli --json info
pocketbase-cli records list users --all
pocketbase-cli collections list
```

进入交互式 REPL：

```sh
pocketbase-cli repl
```

## 命令一览

| 分组 | 子命令 |
| :--- | :--- |
| **auth** | `login` `logout` `status` `whoami` `refresh` |
| **collections** | `list` `get` `create` `update` `ensure` `delete` `truncate` `import` `scaffolds` |
| **records** | `list` `get` `create` `update` `delete` `find` `upsert` `delete-by-filter` |
| **records** (认证) | `auth-methods` `auth-password` `auth-oauth2` `auth-refresh` `request-otp` `auth-otp` `request-password-reset` `confirm-password-reset` `request-verification` `confirm-verification` `request-email-change` `confirm-email-change` `impersonate` |
| **files** | `token` `url` |
| **backups** | `list` `create` `upload` `delete` `download` `restore` |
| **settings** | `get` `patch` `test-s3` `test-email` `apple-client-secret` |
| **logs** | `list` `get` `stats` |
| **crons** | `list` `run` |
| **batch** | `run` |
| **raw** | `<METHOD> <PATH>` &mdash; 任意 HTTP 请求，可选 `--with-auth` |
| **工具** | `info` `schema` `preflight` `config` `history` `undo` `redo` `repl` |

## 配置

### Base URL 解析优先级

```
--base-url 参数  >  config set base_url  >  POCKETBASE_CLI_BASE_URL 环境变量  >  已保存的登录态目标
```

### 环境变量

| 变量 | 用途 |
| :--- | :--- |
| `POCKETBASE_CLI_BASE_URL` | 默认远程目标地址 |
| `POCKETBASE_CLI_STATE_DIR` | 覆盖本地状态目录（默认 `~/.cache/pocketbase-cli`） |

### 状态存储

- config、history、auth 状态默认保存在 `~/.cache/pocketbase-cli`
- session 文件**静态加密**，解密密钥保存在相邻的 `.key` 文件中
- 当 `base_url` 或 `auth_collection` 变更后，不匹配的登录态会被自动清理

## 安全性

- 敏感字段（token、密码、签名 URL）在所有输出中**默认脱敏**
- `files token` 和 `files url` 需显式传 `--reveal-token` 才输出明文
- `raw` 请求默认匿名，需显式传 `--with-auth` 才附带 token
- `auth login` 使用 `127.0.0.1` 临时本地服务，凭据不会离开本机
- 破坏性操作（`delete`、`truncate`、`restore`）需要 `--yes` 确认

## 能力边界

本 CLI 定位为**纯远程模式**，不封装本地 PocketBase 二进制。

**适用场景：** 通过 URL 可访问的已部署实例、Admin/Operator 工作流、CI/CD 流水线、Agent 工具链。

**不覆盖：** `serve`、`migrate`、`update`、本地 superuser 启动流程。

## 文档

| | |
| :--- | :--- |
| [功能参考](FEATURES.md) | 功能与行为说明 |
| [开发指南](DEVELOPMENT.md) | 贡献者与构建指南 |
| [测试策略](TESTING.md) | 测试与验证说明 |
| [更新日志](CHANGELOG.md) | 版本发布记录 |

## 许可

[MIT](LICENSE)
