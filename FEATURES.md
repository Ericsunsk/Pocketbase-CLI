# PocketBase CLI Feature Reference

This document summarizes the current product scope and runtime behavior of PocketBase CLI.

## Product Scope

PocketBase CLI is a remote-only TypeScript command-line client for deployed PocketBase instances. It does not wrap the local PocketBase binary or local process lifecycle commands.

The CLI is designed for:

- operators managing deployed PocketBase instances
- automation and CI workflows
- agent tooling that needs a stable command surface and structured output
- scripted maintenance and administrative tasks

## Supported Command Surface

PocketBase CLI currently covers:

- authentication and auth status inspection
- settings, logs, and cron operations
- collections management and idempotent `collections ensure`
- record CRUD plus auth flows for auth collections
- files URL and file token helpers
- remote backup listing, creation, upload, download, restore, and deletion
- JSON-based record batch mutations
- raw HTTP access for remote endpoints without a dedicated wrapper
- REPL, history, undo, redo, config, schema, and preflight support

## Authentication and State

- The primary login flow is remote PocketBase superuser authentication against `_superusers`, unless another auth collection is configured.
- `auth login` accepts credentials from command arguments or `--password-stdin`.
- `auth login-browser` starts a temporary local server on `127.0.0.1` and presents a browser form for credential entry. It supports `--no-open` for headless environments.
- Persisted config, history, and auth state are stored under `~/.cache/pocketbase-cli` by default.
- The persisted session file is encrypted at rest and uses a sibling `session.json.key` file for local decryption.
- The CLI attempts to restrict both the encrypted session file and the key file to `0600` permissions.
- Supported persisted config keys are `base_url`, `auth_collection`, and `timeout`.
- Supported environment defaults are intentionally limited to `POCKETBASE_CLI_BASE_URL` and `POCKETBASE_CLI_STATE_DIR`.
- Changing persisted `base_url` or `auth_collection` clears saved auth state when it no longer matches the configured target.

## Safety and Validation

- Destructive or side-effectful commands require explicit confirmation through `--yes`.
- `raw` requests remain anonymous unless `--with-auth` is passed explicitly.
- `preflight` is read-only and reports whether `base_url`, auth state, and `/api/health` are ready for the next remote command.
- Base URL values are normalized and validated before remote calls. Invalid URLs, embedded credentials, query strings, and fragments are rejected early.
- Sensitive values such as passwords, file tokens, backup tokens, OAuth2 codes, and code verifiers are redacted from command history and JSON success output where applicable.

## Output and Automation

- `--json` exposes a stable envelope containing `meta`, `result`, structured `error`, `http`, and `pagination`.
- When a command proxies a remote HTTP response, `result` contains the decoded business payload and `data` preserves the raw transport wrapper.
- `schema --json` provides a machine-readable command contract with parameter metadata, examples, enum choices, conflicts, and `input_schema` where available.
- The REPL reuses the same envelope format for JSON output and supports command history redaction.

## Remote Coverage Notes

- `collections ensure` provides idempotent create-or-update behavior keyed by collection name and supports `--if-exists`, `--if-missing`, and `--output summary|full`.
- `records` covers common auth flows for auth collections, including password, OAuth2, OTP, refresh, password reset, verification, email change, and impersonation helpers.
- `records find`, `records upsert`, and `records delete-by-filter` provide higher-level helpers for automation and agent workflows.
- `files url` can generate file URLs and optionally fetch a temporary file token.
- `backups download` fetches archive bytes with binary-safe response handling and writes private local files.
- `batch run` wraps `/api/batch` for JSON-based record mutations and supports `--data`, `--file`, `--file -`, or `--stdin-json`.

## Out of Scope

The following are intentionally outside the current product scope:

- local PocketBase process commands such as `serve`, `migrate`, and `update`
- direct realtime transport wrappers
- local superuser bootstrap flows tied to the embedded PocketBase binary
