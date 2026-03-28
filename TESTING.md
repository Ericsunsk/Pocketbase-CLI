# Testing Guide

This document summarizes the automated validation strategy for PocketBase CLI and the standard commands used to verify a release candidate locally.

## Test Objectives

The automated suite focuses on the behaviors that define the product contract:

- command discovery and help output
- JSON envelope stability for success, error, history, and REPL flows
- authentication, state persistence, and command history redaction
- remote client request construction and error handling
- destructive operation guardrails
- collection, record, file, backup, batch, and raw command behavior

## Covered Areas

### CLI Contract

- installed CLI discoverability through `pocketbase-cli`
- `--help` and `schema --json` coverage for the remote command surface
- schema metadata coverage for examples, conflicts, choices, and `input_schema`
- JSON output stability for `info`, `history`, and REPL streams

### Authentication and State

- remote superuser login via positional password and `--password-stdin`
- browser-assisted login via `auth login-browser --no-open`
- `auth status`, `auth whoami`, `auth refresh`, and logout flows
- auth redaction in history and JSON success output
- encrypted session persistence and private file permissions for `session.json` and its `.key`
- automatic auth clearing when persisted target settings no longer match a stored auth session
- concurrent session save protection and stale lock recovery behavior

### Validation and Safety

- `preflight` readiness reporting for config, auth, and health checks
- acceptance of `POCKETBASE_CLI_BASE_URL` when persisted `base_url` is absent
- early rejection of invalid numeric and base URL inputs
- confirmation requirements for destructive or side-effectful commands
- anonymous-by-default `raw` requests and explicit `--with-auth` attachment

### Remote Operations

- settings, logs, crons, collections, records, files, backups, and batch command coverage
- pagination helpers such as `--all`
- record auth helper flows including OAuth2, refresh, OTP, password reset, verification, and impersonation
- streamed upload and download handling for large backup and binary file flows
- remote client failure wrapping and sensitive-field redaction for JSON and binary responses

### Regression Cases

- token redaction for file URL, file token, backup download, and remote error helpers
- `records auth-refresh --no-save` preserving the previously stored auth session
- `records auth-refresh <collection>` rejecting mismatched saved auth locally
- OAuth2 authorization code and code verifier redaction in record auth history
- mismatched auth target rejection for `raw --with-auth`
- REPL persistence after command exits and redaction of tokenized `raw` paths

## Validation Commands

Run the full local validation set from the repository root:

```sh
npm install
npm run typecheck
npm run lint
npm run test
npm run build
```

## Change Expectations

Any change that affects command semantics, auth handling, state persistence, history redaction, or the JSON output contract should include matching automated coverage updates.
