# Testing

## Coverage

- Installed CLI command discoverability (`pocketbase-cli`)
- `--help` reflects the remote-only command surface
- `schema --json` and `schema <command> --json` discoverability
- `schema collections ensure --json` exposes ensure policy options
- `schema collections ensure --json` exposes ensure output options
- `schema raw --json` exposes parameter help, conflicts, examples, and `input_schema`
- JSON output shape for `info`
- JSON error envelope shape with `meta` and structured `error`
- JSON success envelope keeps decoded business payload in `result`
- JSON output shape for `history`
- JSON REPL stream remains parseable without prompt pollution
- JSON REPL built-ins reuse the same envelope shape as one-shot CLI commands
- `preflight --require-auth --skip-health` reports missing prerequisites without mutating state
- `preflight --require-auth --skip-health` passes when config and saved auth match
- REPL history redacts explicit `files url --token` and `backups download --token` values
- `raw GET /api/health` stays anonymous by default
- `raw GET /api/health --with-auth` attaches the saved auth token explicitly
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
- `config set` clears saved auth when the configured target no longer matches
- `undo` / `redo` also clear saved auth when they restore a conflicting target
- Remote `records auth-methods|auth-password|auth-oauth2|auth-refresh|request-otp|auth-otp|request-password-reset|confirm-password-reset|request-verification|confirm-verification|request-email-change|confirm-email-change|impersonate|create|get|list|update|delete`
- Remote `records list --all`
- Destructive command confirmations via `--yes`
- Remote `batch run`
- Remote `batch run --stdin-json`
- Remote `files token|url`
- Remote `backups list|create|upload|delete|download|restore`

The TypeScript suite uses Vitest plus local stubs/mocks so validation stays deterministic and does not require a real deployed PocketBase instance.

## Validation Commands

```sh
cd <repo-root>
npm install
npm run typecheck
npm run lint
npm run test
npm run build
```
