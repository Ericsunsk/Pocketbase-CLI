# PocketBase CLI

Remote-only CLI-Anything harness for [PocketBase](https://github.com/pocketbase/pocketbase).

## Layout

- `setup.py`: installable package entry point
- `POCKETBASE.md`: harness scope and command surface
- `TEST.md`: validation notes
- `cli_anything/pocketbase/README.md`: end-user usage guide

## Install

Run from the repository root:

```sh
cd agent-harness
```

Then install in a virtual environment:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e .
```

## Global Install (For LLM / Tooling)

```sh
python3 -m pip install --user --break-system-packages <repo-root>/agent-harness
```

## Run

```sh
cli-anything-pocketbase --help
cli-anything-pocketbase auth login
cli-anything-pocketbase auth logout
cli-anything-pocketbase auth logout --yes
cli-anything-pocketbase config set base_url https://pb.example.com
printf 'Secret123\n' | cli-anything-pocketbase auth login --password-stdin admin@example.com
cli-anything-pocketbase schema --json
cli-anything-pocketbase collections ensure --file collection.json
cli-anything-pocketbase collections ensure --file collection.json --if-exists fail
cli-anything-pocketbase collections ensure --file collection.json --output summary
```
