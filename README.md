# PocketBase CLI

This repository contains a standalone remote PocketBase CLI.

## Layout

```text
pocketbase/
├── DEVELOPMENT.md
├── FEATURES.md
├── TESTING.md
├── setup.py
└── pocketbase_cli/
    ├── README.md
    ├── __init__.py
    ├── __main__.py
    ├── pocketbase_cli.py
    ├── core/
    ├── utils/
    └── tests/
```

## Install

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e .
```

## Global Install (For LLM / Tooling)

Install as a user-level command that does not depend on the current working directory:

```sh
python3 -m pip install --user --break-system-packages .
```

If your shell cannot find the command, add one of these to `PATH`:

- `$HOME/.local/bin`
- `$HOME/Library/Python/<python-version>/bin`

## Run

```sh
pocketbase-cli --help
pocketbase-cli auth login
pocketbase-cli auth logout
pocketbase-cli --json info
```
