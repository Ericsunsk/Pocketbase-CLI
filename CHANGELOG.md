# Changelog

All notable changes to this project are documented in this file.

## v0.1.3

### Added

- Encrypted persisted session storage at rest with a sibling `session.json.key` file for local decryption.

### Changed

- Tightened base URL validation across config, preflight, info, and shared remote client setup.
- Limited environment-based defaults to remote target selection and local state directory configuration.
- Updated authentication guidance to use command arguments, `--password-stdin`, or `auth login-browser` for credentials.
- Refined browser-assisted login behavior and documentation for headless environments through `--no-open`.

### Documentation

- Refreshed README, feature reference, development guide, and testing guide content for release-style product documentation.

## v0.1.2

### Added

- Browser-assisted login with `auth login-browser`.
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
