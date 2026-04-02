# Development Guide

This guide covers the standard local workflow for contributing to PocketBase CLI.

## Prerequisites

- Node.js 20 or newer
- npm
- access to a POSIX-like shell environment for local command examples

## Local Setup

Clone the repository, install dependencies, and build the CLI:

```sh
npm install
npm run build
```

Run the built CLI directly from the repository:

```sh
node dist/bin.js --help
```

## Common Development Commands

```sh
npm run typecheck
npm run lint
npm run test
npm run build
```

Clean generated build output when needed:

```sh
npm run clean
```

Watch-mode development build:

```sh
npm run dev
```

## Project Structure

- `src/`: TypeScript source code for commands, shared helpers, input parsing, and HTTP client behavior
- `test/`: Vitest unit coverage for CLI behavior, state handling, and remote client logic
- `README.md`: bilingual landing page
- `README.en.md`: English product guide
- `README.zh-CN.md`: Chinese product guide
- `FEATURES.md`: feature and behavior reference
- `TESTING.md`: test strategy and validation guide
- `CHANGELOG.md`: release notes

## Development Expectations

- Keep the command surface remote-only unless the product scope changes intentionally.
- Preserve the JSON output contract for automation-facing flows.
- Add or update tests when changing auth handling, remote request semantics, state persistence, or command history behavior.
- Update user-facing Markdown documentation when behavior, supported configuration, or command semantics change.
- Prefer small, composable helpers over repeated command scaffolding when behavior is shared across command families.

## Manual Smoke Commands

These commands are useful for local verification after a build:

```sh
node dist/bin.js config set base_url https://pb.example.com
printf 'Secret123\n' | node dist/bin.js auth login --password-stdin admin@example.com
node dist/bin.js auth login --no-open
node dist/bin.js --json preflight --require-auth
node dist/bin.js --json info
node dist/bin.js raw GET /api/health
node dist/bin.js raw GET /api/health --with-auth
node dist/bin.js schema --json
node dist/bin.js collections ensure --file collection.json --output summary
```
