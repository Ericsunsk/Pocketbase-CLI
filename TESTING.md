# Testing

## Unit Coverage (`test_core.py`)

- Session state remote config set/unset persistence behavior
- Undo/redo stack behavior for remote defaults
- Remote config value parsing for `base_url`, `auth_collection`, and `timeout`
- Remote auth state persistence and clearing
- Remote client URL building
- Remote client auth precondition checks
- File URL generation with query parameters
- REPL history redaction for positional secrets while preserving `--password-stdin` identities

## End-to-End Coverage (`test_full_e2e.py`)

- Installed CLI command discoverability (`pocketbase-cli`)
- `--help` reflects the remote-only command surface
- `schema --json` and `schema <command> --json` discoverability
- `schema collections ensure --json` exposes ensure policy options
- `schema collections ensure --json` exposes ensure output options
- JSON output shape for `info`
- JSON error envelope shape with `meta` and structured `error`
- JSON output shape for `history`
- JSON REPL stream remains parseable without prompt pollution
- `raw GET /api/health`
- Collections commands fail cleanly before login
- Remote superuser login persists session state across CLI invocations
- Remote `auth login --password-stdin`
- Remote `auth status`, `auth whoami`, and `auth refresh`
- Remote `settings get|patch|test-s3|test-email|apple-client-secret`
- Remote `settings patch --stdin-json`
- Remote `logs list|get|stats`
- Remote `crons list|run`
- Remote `collections list|get|create|update|ensure|delete|truncate|import|scaffolds`
- Remote `collections ensure --if-exists fail`
- Remote `collections ensure --if-missing fail`
- Remote `collections ensure --output summary`
- Remote `records auth-methods|auth-password|auth-oauth2|auth-refresh|request-otp|auth-otp|request-password-reset|confirm-password-reset|request-verification|confirm-verification|request-email-change|confirm-email-change|impersonate|create|get|list|update|delete`
- Remote `records list --all`
- Destructive command confirmations via `--yes`
- Remote `batch run`
- Remote `batch run --stdin-json`
- Remote `files token|url`
- Remote `backups list|create|upload|delete|download|restore`

Remote API e2e uses a local in-process stub HTTP server so tests stay deterministic and do not require a real deployed PocketBase instance.

## Validation Commands

```sh
cd <repo-root>
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e .
python -m unittest pocketbase_cli.tests.test_core
python -m unittest pocketbase_cli.tests.test_full_e2e
python -m unittest pocketbase_cli.tests.test_core pocketbase_cli.tests.test_full_e2e
```
