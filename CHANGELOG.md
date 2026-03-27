# Changelog

All notable changes to this project will be documented in this file.

## v0.1.1

### Fixed
- Hardened integer option validation across the CLI to prevent silent truncation and ignored malformed numeric input.
- Fixed `records delete-by-filter --expect-count` so invalid numeric values can no longer bypass the count safety check.
- Improved REPL history redaction for `auth login` flows to avoid leaking passwords during mistaken `--password-stdin` usage.
- Rejected unterminated quoted REPL input instead of parsing and executing partial commands.
- Updated `backups download` to write downloaded archives with private local file permissions.
- Removed tokenized backup download URLs from success output to reduce accidental secret exposure in logs and JSON output.
- Changed corrupted `session.json` handling to fail fast instead of silently resetting to an empty session.

### Validation
- `npm run typecheck`
- `npm test`
- `npm run build`

### Reference
- Commit: `b87ef81ce756fbeb0455cc59316414669a7cf01f`
