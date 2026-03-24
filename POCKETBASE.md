# PocketBase CLI-Anything Harness

Target software: PocketBase
Source path: `/Users/apple/pocketbase`
Harness path: `/Users/apple/pocketbase/agent-harness`

## What This Harness Provides

- Remote-only Click CLI for deployed PocketBase instances
- Default interactive REPL when no subcommand is provided
- Machine-readable `--json` output mode
- Machine-readable `schema --json` command contract for tools and LLMs
- One-shot command coverage for remote admin operations:
  - auth and session management
  - settings, logs, crons, collections, records, batch, files, and backups
  - raw HTTP access for endpoints without a dedicated wrapper
- Session config persistence plus `undo`/`redo` for remote defaults
- Remote auth session persistence with saved base URL, token, and current record
- stdin-first JSON input flows via `--file`, `--file -`, and `--stdin-json`
- secret-safe auth via `auth login --password-stdin`
- explicit guardrails on destructive or side-effectful commands via `--yes`
- pagination helpers via `--all`
- filter helpers via `records find`, `records upsert`, and `records delete-by-filter`
- idempotent collection provisioning via `collections ensure`
- explicit ensure conflict policies via `--if-exists` and `--if-missing`
- compact ensure output via `--output summary|full`
- Best-effort `/api/health` probe in `info`
- Canonical command surface and examples live in `cli_anything/pocketbase/README.md`

## Backend Strategy

This harness no longer wraps the local PocketBase CLI.

All operational commands use PocketBase's HTTP API against a remote deployment. The intended primary auth flow is PocketBase `superuser` login against the `_superusers` collection.

## Notes

- Session history, config, and auth state are stored in `~/.cache/cli-anything-pocketbase` by default.
- The harness attempts to restrict the session file permissions to `0600`.
- Supported persisted config keys are `base_url`, `auth_collection`, and `timeout`.
- Hidden compatibility aliases under `remote ...` remain available, but the preferred command surface is the top-level groups.
- JSON output now exposes a stable envelope with `meta`, `result`, structured `error`, `http`, and `pagination`.
- `files url` is a helper that builds PocketBase file URLs and can optionally fetch a temporary file token via `/api/files/token`.
- `logs stats` wraps `/api/logs/stats` for quick operational summaries without falling back to `raw`.
- `crons` wraps `/api/crons` list/run operations.
- `collections` now covers the documented remote collection management routes instead of only list/get.
- `collections ensure` provides an idempotent create-or-update helper keyed by payload `name`.
- `collections ensure` can also be tightened with `--if-exists update|fail` and `--if-missing create|fail` for stricter agent control.
- `collections ensure --output summary` returns a compact agent-oriented result instead of the full remote body.
- `records` now covers the major documented auth flows for auth collections, including `auth-with-oauth2`, plus higher-level `find`, `upsert`, and `delete-by-filter` helpers for agent workflows.
- `settings` now covers the documented S3/email test routes and Apple client secret generation route.
- `backups` wraps the remote backup list/create/delete endpoints that are relevant for deployed VPS setups.
- `backups upload` wraps the documented multipart upload endpoint for restoring externally prepared archives into the remote backup store.
- `backups download` uses a temporary file token and writes the archive locally.
- `backups delete` and `backups restore` are intentionally guarded by `--yes`.
- `collections delete`, `collections truncate`, `records delete`, `records delete-by-filter`, and `crons run` are also intentionally guarded by `--yes`.
- `batch run` wraps `/api/batch` for JSON-based record batch mutations and supports `--data`, `--file`, `--file -`, or `--stdin-json`.
- Local process-oriented commands are intentionally removed from the CLI model because they are not meaningful for a remote VPS deployment.
- Remaining deliberate gaps relative to the official docs are `realtime`.
