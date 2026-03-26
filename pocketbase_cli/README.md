# pocketbase-cli

Detailed command reference for the standalone remote CLI for [PocketBase](https://github.com/pocketbase/pocketbase).

If you are looking for the project overview, install options, and repository layout, start with the repository root `README.md`.

## Install

Use a virtual environment so editable installs do not depend on a system Python policy override.

```sh
cd <repo-root>
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e .
```

## Quick Start

```sh
pocketbase-cli config set base_url https://pb.example.com
pocketbase-cli config set auth_collection _superusers
printf 'Secret123\n' | pocketbase-cli auth login --password-stdin admin@example.com
pocketbase-cli --json info
pocketbase-cli schema --json
pocketbase-cli records list users --all
```

No subcommand starts REPL mode:

```sh
pocketbase-cli
```

## Common Workflows

- authenticate against a deployed PocketBase admin endpoint
- inspect the full CLI contract with `schema --json`
- run remote admin operations with stable JSON output
- use REPL mode for iterative maintenance and troubleshooting

## Automation and Agent Features

- `schema --json` and `schema <command path> --json` expose a machine-readable command contract
- Stable JSON envelope with `meta`, `result`, `error`, `http`, and `pagination`
- stdin-first JSON inputs with `--file`, `--file -`, and `--stdin-json`
- direct record file uploads with repeatable `--binary-file field=path`
- secret-safe auth input with `auth login --password-stdin`
- explicit destructive-operation guardrails via `--yes`
- pagination helpers via `--all`
- explicit ensure policies via `--if-exists` and `--if-missing`
- compact ensure responses via `--output summary|full`
- filter helpers for record lookup and mutation:
  - `records find`
  - `records upsert`
  - `records delete-by-filter`

## Command Groups

- `info`: remote CLI details, defaults, auth state, and `/api/health` probe
- `schema [<command path...>]`: machine-readable command contract for tools and LLMs
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

## Remote Scope

This CLI is pure remote mode. It does not wrap the local PocketBase binary anymore.

Use it when you need:

- operator access to a deployed PocketBase instance
- scriptable admin workflows with structured output
- agent-friendly command discovery and guardrails

Not supported:

- local `serve`
- local `migrate`
- local `update`
- local `superuser` CLI wrappers

## Schema Contract

Discover the full command surface without scraping help text:

```sh
pocketbase-cli schema --json
pocketbase-cli schema records list --json
pocketbase-cli schema backups restore --json
```

The schema contract includes:

- `commands`: list of command and group entries
- `path`: dot-notated command path such as `records.list`
- `arguments`: positional arguments with type and requiredness
- `options`: flags and options with defaults and help text
- `auth_required`
- `dangerous`
- `confirmation_required` and `confirmation_flag`
- `examples`

Hidden compatibility aliases can be included with:

```sh
pocketbase-cli schema --json --include-hidden
```

## JSON Output Contract

Use `--json` for stable machine output:

```sh
pocketbase-cli --json info
pocketbase-cli --json settings get
pocketbase-cli --json records list users --all
```

Success payload shape:

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

Error payloads keep the same top-level envelope and add structured error metadata:

- `error.type`
- `error.message`
- `error.retryable`
- `error.hint`
- `error.missing_prerequisite`
- `error.http_status`

## Input Patterns

For JSON body commands, prefer these patterns in order:

1. `--file payload.json`
2. `--file -`
3. `--stdin-json`
4. `--data '{...}'`

Examples:

```sh
pocketbase-cli settings patch --file settings.json
printf '{"meta":{"appName":"Patched via stdin"}}\n' | pocketbase-cli settings patch --stdin-json
printf '{"requests":[{"method":"POST","url":"/api/collections/users/records","body":{"email":"stdin@example.com"}}]}\n' | pocketbase-cli batch run --stdin-json
```

`auth login` supports secret-safe stdin input:

```sh
printf 'Secret123\n' | pocketbase-cli auth login --password-stdin admin@example.com
```

Record create/update/upsert can upload binary files directly:

```sh
pocketbase-cli records update users RECORD_ID --data '{"name":"With avatar"}' --binary-file avatar=./avatar.png
pocketbase-cli records upsert users --filter 'email="a@example.com"' --binary-file avatar=./avatar.png
```

`--binary-file` is repeatable and accepts raw PocketBase file field keys, including modifiers like `field+` for append.

## Safety Rails

The following commands require explicit confirmation with `--yes`:

- `records delete`
- `records delete-by-filter`
- `collections delete`
- `collections truncate`
- `crons run`
- `backups delete`
- `backups restore`

This is intentional so an agent must acknowledge destructive or side-effectful work.

`collections ensure` keys off the submitted payload `name` and then creates or updates that collection. It is intentionally not a rename helper; use `collections update` when you need to rename an existing collection explicitly.

For stricter agent workflows, `collections ensure` also supports:

- `--if-exists update|fail`
- `--if-missing create|fail`
- `--output summary|full`

Defaults are `update`, `create`, and `full`.

Use `--output summary` when the caller only needs the high-level result instead of the full remote response body.

## Examples

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

## Config and Session

Session state is stored under `~/.cache/pocketbase-cli/session.json` by default.

Stored state includes:

- saved remote defaults from `config`
- command history
- undo/redo stacks for config changes
- remote auth base URL, token, and current record

The CLI attempts to restrict the session file permissions to `0600`.

## Coverage Notes

This CLI covers the documented remote admin APIs plus the major record auth flows for deployed PocketBase instances.

The main deliberate gap is:

- `realtime`
