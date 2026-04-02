# Changelog

All notable changes to this project are documented in this file.

## v0.1.7

### Changed

- Consolidated browser-assisted authentication under `auth login` and removed the separate `auth login-browser` command path.
- `auth login` now consistently uses the local loopback browser flow and persists successful remote auth state after form submission.
- Updated auth-related command history/action labels to the unified `auth login` naming.

### Documentation

- Refreshed README files (`README.md`, `README.en.md`, `README.zh-CN.md`) around installation/auth usage and aligned uninstall instructions to a one-line full cleanup command.
- Updated release and contributor docs to reflect the current auth flow and command examples.

## v0.1.6

### Changed

- Removed the redundant `dangerous` field from the `schema --json` contract. Use `destructive` instead.
- Improved `--filter` and `--sort` help text with inline syntax examples across records and collections commands.

### Added

- Added usage examples to all commands that previously lacked them: `backups` (all 6 subcommands), `records delete`, `records delete-by-filter`, `records auth-otp`, `records request-otp`, `records request-password-reset`, `records confirm-password-reset`, `records request-verification`, `records confirm-verification`, `records request-email-change`, `records confirm-email-change`, `records auth-methods`, `collections delete`, `collections truncate`, and `auth logout`.
- Added `help` text to all inline parameter definitions in destructive commands (`backups delete/restore/download`, `records delete/delete-by-filter`, `collections delete/truncate`).
- Added `notes` documenting multi-step authentication flows: MFA continuation via `--mfa-id`, OTP two-step flow (`request-otp` then `auth-otp`), password reset and verification request-then-confirm patterns.
- Added PocketBase filter and sort syntax documentation to `records.list` notes.
- Marked `backups.download --token` as `sensitive: true` in the schema contract.

## v0.1.5

### Changed

- Upgraded the development toolchain to `eslint` 9, `@typescript-eslint` 8, `tsup` 8.5.1, and `vitest` 4.1.2.
- Migrated lint configuration from legacy `.eslintrc.json` to flat-config `eslint.config.mjs`.
- Tightened test linting so test helpers still keep signal without forcing noisy explicit return types on routine builder/context wrappers.

### Added

- Added `scripts/install-global.sh` for one-line install or update from GitHub.
- Documented one-line install flow and PATH behavior in the bilingual README files.

### Validation

- `npm install`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`

## v0.1.4

### Added

- Added `files url --reveal-token` as an explicit opt-in for printing signed file URLs and temporary file tokens.
- Added a dedicated `src/core/version.ts` source of truth so the CLI runtime version and default `User-Agent` stay aligned with `package.json`.

### Changed

- `files token` and tokenized `files url` output are now redacted by default to reduce accidental secret exposure in terminals, logs, and JSON pipelines.
- Remote success and error output now sanitize secret-like fields and signed URLs more consistently across command families.
- Session state saves now merge concurrent updates and use a stronger lock ownership check to reduce cross-process overwrite risk.

### Fixed

- Streamed backup upload and download flows plus binary record uploads to avoid loading whole files into memory.
- Preserved REPL history persistence when commands exit early and aligned REPL `raw` history redaction with one-shot CLI mode.
- Rejected more invalid numeric inputs and normalized batch payload `method` and `url` values before dispatch.
- Fixed `--binary-file <field>=<path>` parsing for file paths containing `=`.
- Restored proper source exclusivity for `--file -` together with `--stdin-json`.
- Allowed startup to continue when `POCKETBASE_CLI_BASE_URL` is present but invalid, surfacing the problem in `info` instead of bricking the CLI.
- Restored local auth target validation for `records auth-refresh <collection>` before the remote request is sent.

## v0.1.3

### Added

- Encrypted persisted session storage at rest with a sibling `session.json.key` file for local decryption.

### Changed

- Tightened base URL validation across config, preflight, info, and shared remote client setup.
- Limited environment-based defaults to remote target selection and local state directory configuration.
- Updated authentication guidance to use command arguments, `--password-stdin`, or `auth login` for credentials.
- Refined browser-assisted login behavior and documentation for headless environments through `--no-open`.

### Documentation

- Refreshed README, feature reference, development guide, and testing guide content for release-style product documentation.

## v0.1.2

### Added

- Browser-assisted login with `auth login`.
- Local loopback login flow that can run without auto-opening a browser.
- Expanded readiness and login reporting around remote authentication flows.

### Changed

- Improved browser login presentation and PocketBase-aligned styling.
- Refined remote target resolution and auth-related output messaging.

## v0.1.1

### Fixed

- Hardened integer option validation to prevent silent truncation and ignored malformed numeric input.
- Fixed `records delete-by-filter --expect-count` so invalid numeric values can no longer bypass the count safety check.
- Improved REPL history redaction for `auth login` flows to avoid leaking passwords during mistaken `--password-stdin` usage.
- Rejected unterminated quoted REPL input instead of parsing and executing partial commands.
- Updated `backups download` to write downloaded archives with private local file permissions.
- Removed tokenized backup download URLs from success output to reduce accidental secret exposure in logs and JSON output.
- Changed corrupted `session.json` handling to fail fast instead of silently resetting to an empty session.
