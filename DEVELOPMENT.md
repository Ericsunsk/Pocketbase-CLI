# PocketBase CLI

Remote-only standalone CLI for [PocketBase](https://github.com/pocketbase/pocketbase).

## Layout

- `package.json`: npm package metadata and CLI bin mapping
- `src/`: TypeScript source code
- `test/`: Vitest test suite
- `FEATURES.md`: CLI scope and command surface
- `TESTING.md`: validation notes
- `README.en.md` / `README.zh-CN.md`: end-user guides

## Install

Run from the repository root:

```sh
cd <repo-root>
```

Then install dependencies and build:

```sh
npm install
npm run build
```

## Global Install (For LLM / Tooling)

```sh
npm i -g pocketbase-cli
```

## Run

```sh
node dist/bin.js --help
node dist/bin.js auth login
node dist/bin.js auth logout
node dist/bin.js auth logout --yes
node dist/bin.js config set base_url https://pb.example.com
printf 'Secret123\n' | node dist/bin.js auth login --password-stdin admin@example.com
node dist/bin.js schema --json
node dist/bin.js collections ensure --file collection.json
node dist/bin.js collections ensure --file collection.json --if-exists fail
node dist/bin.js collections ensure --file collection.json --output summary
```
