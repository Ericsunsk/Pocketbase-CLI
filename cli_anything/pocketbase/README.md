# cli-anything-pocketbase

Remote-only CLI-Anything harness for [PocketBase](https://github.com/pocketbase/pocketbase).

## Install

Use a virtual environment so editable installs do not depend on a system Python policy override.

```sh
cd /Users/apple/pocketbase/agent-harness
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e .
```

## Quick Start

```sh
cli-anything-pocketbase config set base_url https://pb.example.com
printf 'Secret123\n' | cli-anything-pocketbase auth login --password-stdin admin@example.com
cli-anything-pocketbase --json info
cli-anything-pocketbase schema --json
cli-anything-pocketbase records list users --all
```

No subcommand starts REPL mode:

```sh
cli-anything-pocketbase
```

## LLM-Oriented Features

- `schema --json` and `schema <command path> --json` expose a machine-readable command contract
- Stable JSON envelope with `meta`, `result`, `error`, `http`, and `pagination`
- stdin-first JSON inputs with `--file`, `--file -`, and `--stdin-json`
- secret-safe auth input with `auth login --password-stdin`
- explicit destructive-operation guardrails via `--yes`
- pagination helpers via `--all`
- explicit ensure policies via `--if-exists` and `--if-missing`
- filter helpers for record lookup and mutation:
  - `records find`
  - `records upsert`
  - `records delete-by-filter`

## Commands

- `info`: remote harness details, defaults, auth state, and `/api/health` probe
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

## Schema Contract

Discover the full command surface without scraping help text:

```sh
cli-anything-pocketbase schema --json
cli-anything-pocketbase schema records list --json
cli-anything-pocketbase schema backups restore --json
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
cli-anything-pocketbase schema --json --include-hidden
```

## JSON Output Contract

Use `--json` for stable machine output:

```sh
cli-anything-pocketbase --json info
cli-anything-pocketbase --json settings get
cli-anything-pocketbase --json records list users --all
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
cli-anything-pocketbase settings patch --file settings.json
printf '{"meta":{"appName":"Patched via stdin"}}\n' | cli-anything-pocketbase settings patch --stdin-json
printf '{"requests":[{"method":"POST","url":"/api/collections/users/records","body":{"email":"stdin@example.com"}}]}\n' | cli-anything-pocketbase batch run --stdin-json
```

`auth login` supports secret-safe stdin input:

```sh
printf 'Secret123\n' | cli-anything-pocketbase auth login --password-stdin admin@example.com
```

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

Defaults are `update` and `create`.

## Examples

```sh
cli-anything-pocketbase config set base_url https://pb.example.com
cli-anything-pocketbase config set auth_collection _superusers
printf 'Secret123\n' | cli-anything-pocketbase auth login --password-stdin admin@example.com
cli-anything-pocketbase auth refresh
cli-anything-pocketbase settings get
cli-anything-pocketbase settings patch --data '{"meta":{"appName":"My PB"}}'
cli-anything-pocketbase settings test-s3 --data '{"filesystem":"storage"}'
cli-anything-pocketbase settings test-email --data '{"template":"verification","email":"test@example.com"}'
cli-anything-pocketbase logs list --filter 'data.status>200' --all
cli-anything-pocketbase logs stats --filter 'data.status>200'
cli-anything-pocketbase crons list
cli-anything-pocketbase crons run test --yes
cli-anything-pocketbase collections get users
cli-anything-pocketbase collections create --file collection.json
cli-anything-pocketbase collections update users --data '{"name":"users_v2"}'
cli-anything-pocketbase collections ensure --file collection.json
cli-anything-pocketbase collections ensure --file collection.json --if-exists fail
cli-anything-pocketbase collections ensure --file collection.json --if-missing fail
cli-anything-pocketbase collections truncate users --yes
cli-anything-pocketbase collections import --file import.json
cli-anything-pocketbase collections scaffolds
cli-anything-pocketbase records auth-methods users
cli-anything-pocketbase records auth-password users test@example.com Secret123
cli-anything-pocketbase records auth-oauth2 users --provider google --code OAUTH_CODE --redirect-url https://app.example.com/callback --code-verifier PKCE_VERIFIER --create-file oauth-create.json
cli-anything-pocketbase records auth-refresh users
cli-anything-pocketbase records request-otp users test@example.com
cli-anything-pocketbase records auth-otp users OTP_ID 654321
cli-anything-pocketbase records request-password-reset users test@example.com
cli-anything-pocketbase records request-verification users test@example.com
cli-anything-pocketbase records request-email-change users changed@example.com
cli-anything-pocketbase records impersonate users USER_ID
cli-anything-pocketbase records list users --all
cli-anything-pocketbase records find users --filter 'email="test@example.com"' --first
cli-anything-pocketbase records create users --file record.json
cli-anything-pocketbase records update users RECORD_ID --stdin-json
cli-anything-pocketbase records upsert users --filter 'email="sync@example.com"' --file upsert.json
cli-anything-pocketbase records delete users RECORD_ID --yes
cli-anything-pocketbase records delete-by-filter users --filter 'status="inactive"' --expect-count 3 --yes
cli-anything-pocketbase batch run --file requests.json
cli-anything-pocketbase files token
cli-anything-pocketbase files url users RECORD_ID avatar.png --thumb 100x100 --with-token
cli-anything-pocketbase backups list
cli-anything-pocketbase backups create --name nightly.zip
cli-anything-pocketbase backups upload ./nightly.zip
cli-anything-pocketbase backups download nightly.zip --output ./nightly.zip
cli-anything-pocketbase backups delete nightly.zip --yes
cli-anything-pocketbase backups restore nightly.zip --yes
cli-anything-pocketbase raw GET /api/health
```

## Remote Model

This harness is pure remote mode. It does not wrap the local PocketBase binary anymore.

Practical consequence:

- use this CLI for deployed PocketBase instances reachable by URL
- use `auth login` with PocketBase `superuser` credentials by default
- the default auth collection is `_superusers`

Not supported:

- local `serve`
- local `migrate`
- local `update`
- local `superuser` CLI wrappers

## Config and Session

Session state is stored under `~/.cache/cli-anything-pocketbase/session.json` by default.

Stored state includes:

- saved remote defaults from `config`
- command history
- undo/redo stacks for config changes
- remote auth base URL, token, and current record

The harness attempts to restrict the session file permissions to `0600`.

## Coverage Notes

This harness covers the documented remote admin APIs plus the major record auth flows for deployed PocketBase instances.

The main deliberate gap is:

- `realtime`
