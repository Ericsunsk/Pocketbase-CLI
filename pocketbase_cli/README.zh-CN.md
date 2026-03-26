# pocketbase-cli

独立远程 PocketBase CLI 的中文详细命令手册。

[`English`](README.md) | [`简体中文`](README.zh-CN.md) | [`项目首页`](../README.md)

如果你想先了解项目定位、安装方式和仓库结构，建议先阅读仓库根目录下的 `README.md`。

## 安装

建议使用 virtual environment，避免 editable install 受系统 Python 策略影响。

```sh
cd <repo-root>
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e .
```

## 快速开始

```sh
pocketbase-cli config set base_url https://pb.example.com
pocketbase-cli config set auth_collection _superusers
printf 'Secret123\n' | pocketbase-cli auth login --password-stdin admin@example.com
pocketbase-cli --json info
pocketbase-cli schema --json
pocketbase-cli records list users --all
```

不带子命令直接运行会进入 REPL：

```sh
pocketbase-cli
```

## 常见工作流

- 对已部署的 PocketBase Admin Endpoint 做认证
- 通过 `schema --json` 检查完整命令契约
- 用稳定的 JSON 输出执行远程管理操作
- 在 REPL 中做迭代式维护、巡检与排障

## 自动化与 Agent 特性

- `schema --json` 和 `schema <command path> --json` 可暴露机读命令契约
- 稳定 JSON Envelope，包含 `meta`、`result`、`error`、`http`、`pagination`
- stdin-first JSON 输入模式，支持 `--file`、`--file -`、`--stdin-json`
- 通过可重复的 `--binary-file field=path` 直接上传 Record 文件
- `auth login --password-stdin` 支持更安全的 Secret 输入方式
- 破坏性操作需要显式 `--yes`
- `--all` 可自动拉取分页数据
- `collections ensure` 支持 `--if-exists`、`--if-missing`、`--output`
- 提供 `records find`、`records upsert`、`records delete-by-filter` 这类更适合自动化的辅助命令

## 命令分组

- `info`：查看远程 CLI 信息、默认配置、认证状态与 `/api/health`
- `schema [<command path...>]`：输出给工具和 LLM 使用的命令契约
- `auth login|logout|status|whoami|refresh`
- `settings get|patch|test-s3|test-email|apple-client-secret`
- `logs list|get|stats`
- `crons list|run`
- `collections list|get|create|update|ensure|delete|truncate|import|scaffolds`
- `records auth-methods|auth-password|auth-oauth2|auth-refresh|request-otp|auth-otp|request-password-reset|confirm-password-reset|request-verification|confirm-verification|request-email-change|confirm-email-change|impersonate|list|get|create|update|delete|find|upsert|delete-by-filter`
- `batch run`
- `files token|url`
- `backups list|create|upload|delete|download|restore`
- `raw <METHOD> <PATH> [--data '{...}']`
- `config show|set|unset`
- `undo` / `redo`
- `history`
- `repl`

## 远程能力边界

这个 CLI 是纯远程模式，不封装本地 PocketBase Binary。

适合的场景：

- 面向已部署 PocketBase 实例的运维管理
- 需要结构化输出的脚本和自动化任务
- 需要命令发现和安全护栏的 Agent Tooling

不支持：

- 本地 `serve`
- 本地 `migrate`
- 本地 `update`
- 本地 `superuser` CLI wrapper

## Schema Contract

无需解析 help 文本，也能发现完整命令面：

```sh
pocketbase-cli schema --json
pocketbase-cli schema records list --json
pocketbase-cli schema backups restore --json
```

Schema Contract 包含：

- `commands`：命令和分组条目列表
- `path`：如 `records.list` 这样的 dot notation 命令路径
- `arguments`：位置参数及其类型、必填信息
- `options`：flags 和 options，以及默认值和 help 信息
- `auth_required`
- `dangerous`
- `confirmation_required` 与 `confirmation_flag`
- `examples`

如果需要包含隐藏兼容别名，可以这样调用：

```sh
pocketbase-cli schema --json --include-hidden
```

## JSON 输出契约

对自动化调用建议始终启用 `--json`：

```sh
pocketbase-cli --json info
pocketbase-cli --json settings get
pocketbase-cli --json records list users --all
```

成功返回示例：

```json
{
  "ok": true,
  "action": "records.list",
  "message": "Records list completed",
  "meta": {
    "schema_version": "pocketbase-cli/v1",
    "command": "records.list"
  },
  "result": {
    "method": "GET",
    "url": "https://pb.example.com/api/collections/users/records?page=1",
    "status": 200,
    "data": {
      "items": []
    }
  },
  "http": {
    "method": "GET",
    "url": "https://pb.example.com/api/collections/users/records?page=1",
    "status": 200
  },
  "pagination": {
    "page": 1,
    "item_count": 0,
    "has_more": false
  }
}
```

错误返回会保持相同的顶层结构，并附带结构化错误字段：

- `error.type`
- `error.message`
- `error.retryable`
- `error.hint`
- `error.missing_prerequisite`
- `error.http_status`

## 输入模式

对于需要 JSON Body 的命令，推荐按以下优先级使用：

1. `--file payload.json`
2. `--file -`
3. `--stdin-json`
4. `--data '{...}'`

示例：

```sh
pocketbase-cli settings patch --file settings.json
printf '{"meta":{"appName":"Patched via stdin"}}\n' | pocketbase-cli settings patch --stdin-json
printf '{"requests":[{"method":"POST","url":"/api/collections/users/records","body":{"email":"stdin@example.com"}}]}\n' | pocketbase-cli batch run --stdin-json
```

`auth login` 支持更安全的 stdin Secret 输入：

```sh
printf 'Secret123\n' | pocketbase-cli auth login --password-stdin admin@example.com
```

`records create`、`records update`、`records upsert` 可直接上传 Binary File：

```sh
pocketbase-cli records update users RECORD_ID --data '{"name":"With avatar"}' --binary-file avatar=./avatar.png
pocketbase-cli records upsert users --filter 'email="a@example.com"' --binary-file avatar=./avatar.png
```

`--binary-file` 支持重复传入，也支持像 `field+` 这样的 PocketBase File Field Modifier。

## 安全护栏

以下命令必须显式传入 `--yes`：

- `records delete`
- `records delete-by-filter`
- `collections delete`
- `collections truncate`
- `crons run`
- `backups delete`
- `backups restore`

这个设计是有意为之，目的是让脚本或 Agent 明确确认破坏性或有副作用的操作。

`collections ensure` 通过提交 payload 中的 `name` 来判断目标集合，然后执行 create 或 update。它不是 rename helper；如果你要重命名已有集合，请使用 `collections update`。

更严格的 Agent Workflow 可以搭配：

- `--if-exists update|fail`
- `--if-missing create|fail`
- `--output summary|full`

默认值分别是 `update`、`create` 和 `full`。

如果调用方只需要高层结果，不需要完整远程响应，可以使用 `--output summary`。

## 示例

```sh
pocketbase-cli config set base_url https://pb.example.com
pocketbase-cli config set auth_collection _superusers
printf 'Secret123\n' | pocketbase-cli auth login --password-stdin admin@example.com
pocketbase-cli auth refresh
pocketbase-cli settings get
pocketbase-cli settings patch --data '{"meta":{"appName":"My PB"}}'
pocketbase-cli settings test-s3 --data '{"filesystem":"storage"}'
pocketbase-cli settings test-email --data '{"template":"verification","email":"test@example.com"}'
pocketbase-cli logs list --filter 'data.status>200' --all
pocketbase-cli logs stats --filter 'data.status>200'
pocketbase-cli crons list
pocketbase-cli crons run test --yes
pocketbase-cli collections get users
pocketbase-cli collections create --file collection.json
pocketbase-cli collections update users --data '{"name":"users_v2"}'
pocketbase-cli collections ensure --file collection.json
pocketbase-cli collections ensure --file collection.json --if-exists fail
pocketbase-cli collections ensure --file collection.json --if-missing fail
pocketbase-cli collections ensure --file collection.json --output summary
pocketbase-cli collections truncate users --yes
pocketbase-cli collections import --file import.json
pocketbase-cli collections scaffolds
pocketbase-cli records auth-methods users
pocketbase-cli records auth-password users test@example.com Secret123
pocketbase-cli records auth-oauth2 users --provider google --code OAUTH_CODE --redirect-url https://app.example.com/callback --code-verifier PKCE_VERIFIER --create-file oauth-create.json
pocketbase-cli records auth-refresh users
pocketbase-cli records request-otp users test@example.com
pocketbase-cli records auth-otp users OTP_ID 654321
pocketbase-cli records request-password-reset users test@example.com
pocketbase-cli records request-verification users test@example.com
pocketbase-cli records request-email-change users changed@example.com
pocketbase-cli records impersonate users USER_ID
pocketbase-cli records list users --all
pocketbase-cli records find users --filter 'email="test@example.com"' --first
pocketbase-cli records create users --file record.json
pocketbase-cli records update users RECORD_ID --stdin-json
pocketbase-cli records upsert users --filter 'email="sync@example.com"' --file upsert.json
pocketbase-cli records delete users RECORD_ID --yes
pocketbase-cli records delete-by-filter users --filter 'status="inactive"' --expect-count 3 --yes
pocketbase-cli batch run --file requests.json
pocketbase-cli files token
pocketbase-cli files url users RECORD_ID avatar.png --thumb 100x100 --with-token
pocketbase-cli backups list
pocketbase-cli backups create --name nightly.zip
pocketbase-cli backups upload ./nightly.zip
pocketbase-cli backups download nightly.zip --output ./nightly.zip
pocketbase-cli backups delete nightly.zip --yes
pocketbase-cli backups restore nightly.zip --yes
pocketbase-cli raw GET /api/health
```

## 配置与 Session

Session State 默认保存在 `~/.cache/pocketbase-cli/session.json`。

其中包括：

- 通过 `config` 保存的远程默认配置
- 命令历史
- 配置变更的 undo/redo 栈
- 远程认证的 base URL、token 和当前 record 信息

CLI 会尽量把 Session File 权限收紧到 `0600`。

## 覆盖范围说明

这个 CLI 覆盖了已部署 PocketBase 实例常见的远程 Admin API，以及 Auth Collection 相关的主要认证流程。

当前刻意保留的主要空缺是：

- `realtime`
