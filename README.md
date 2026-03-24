# PocketBase CLI-Anything Harness

This repository follows the strict CLI-Anything Build template.

## Layout

```text
pocketbase/
└── agent-harness/
    ├── POCKETBASE.md
    ├── setup.py
    └── cli_anything/
        └── pocketbase/
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
cd agent-harness
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e .
```

## Global Install (For LLM / Tooling)

Install as a user-level command that does not depend on the current working directory:

```sh
python3 -m pip install --user --break-system-packages ./agent-harness
```

If your shell cannot find the command, add one of these to `PATH`:

- `$HOME/.local/bin`
- `$HOME/Library/Python/<python-version>/bin`

## Run

```sh
cli-anything-pocketbase --help
cli-anything-pocketbase --json info
```
