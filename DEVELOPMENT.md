# PocketBase CLI

Remote-only standalone CLI for [PocketBase](https://github.com/pocketbase/pocketbase).

## Layout

- `setup.py`: installable package entry point
- `FEATURES.md`: CLI scope and command surface
- `TESTING.md`: validation notes
- `pocketbase_cli/README.md`: end-user usage guide

## Install

Run from the repository root:

```sh
cd <repo-root>
```

Then install in a virtual environment:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e .
```

## Global Install (For LLM / Tooling)

```sh
python3 -m pip install --user --break-system-packages <repo-root>
```

## Run

```sh
pocketbase-cli --help
pocketbase-cli auth login
pocketbase-cli auth logout
pocketbase-cli auth logout --yes
pocketbase-cli config set base_url https://pb.example.com
printf 'Secret123\n' | pocketbase-cli auth login --password-stdin admin@example.com
pocketbase-cli schema --json
pocketbase-cli collections ensure --file collection.json
pocketbase-cli collections ensure --file collection.json --if-exists fail
pocketbase-cli collections ensure --file collection.json --output summary
```
