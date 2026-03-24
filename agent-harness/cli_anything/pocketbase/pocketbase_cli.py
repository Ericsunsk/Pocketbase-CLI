from __future__ import annotations

import json
import re
import shlex
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

import click

from cli_anything.pocketbase.core.output import emit_error, emit_success
from cli_anything.pocketbase.core.repl import PocketBaseRepl
from cli_anything.pocketbase.core.session import SessionStore, parse_config_value
from cli_anything.pocketbase.utils.pocketbase_remote import (
    PocketBaseRemoteClient,
    PocketBaseRemoteError,
    RemoteResult,
)


_BATCH_ALLOWED_PATTERNS = {
    "POST": re.compile(r"^/api/collections/[^/?]+/records(\?.*)?$"),
    "PUT": re.compile(r"^/api/collections/[^/?]+/records(\?.*)?$"),
    "PATCH": re.compile(r"^/api/collections/[^/?]+/records/[^/?]+(\?.*)?$"),
    "DELETE": re.compile(r"^/api/collections/[^/?]+/records/[^/?]+(\?.*)?$"),
}

_RECORD_BASE_URL_REQUIRED_MESSAGE = "Base URL is required. Run `config set base_url <url>` first."
_LOGIN_BASE_URL_REQUIRED_MESSAGE = (
    "Base URL is required. Pass `--base-url` or persist it with `config set base_url <url>`."
)
_FILE_TOKEN_RESPONSE_ERROR_MESSAGE = "File token response did not include a usable token."
_SCHEMA_VERSION = "1.0.0"
_DEFAULT_ALL_PER_PAGE = 200
_SCHEMA_EXAMPLES: dict[str, list[str]] = {
    "info": ["cli-anything-pocketbase --json info"],
    "schema": [
        "cli-anything-pocketbase schema --json",
        "cli-anything-pocketbase schema records list --json",
    ],
    "auth login": ["printf 'Secret123\\n' | cli-anything-pocketbase --json auth login --password-stdin admin@example.com"],
    "records list": ["cli-anything-pocketbase --json records list users --per-page 20"],
    "records find": ["cli-anything-pocketbase --json records find users --filter 'email=\"test@example.com\"' --first"],
    "records upsert": ["cli-anything-pocketbase --json records upsert users --filter 'email=\"sync@example.com\"' --file upsert.json"],
    "records delete": ["cli-anything-pocketbase --json records delete users RECORD_ID --yes"],
    "records delete-by-filter": [
        "cli-anything-pocketbase --json records delete-by-filter users --filter 'status=\"inactive\"' --expect-count 3 --yes"
    ],
    "collections truncate": ["cli-anything-pocketbase --json collections truncate users --yes"],
    "collections ensure": [
        "cli-anything-pocketbase --json collections ensure --file collection.json",
        "cli-anything-pocketbase --json collections ensure --file collection.json --output summary",
    ],
    "batch run": ["cli-anything-pocketbase --json batch run --file requests.json"],
    "backups restore": ["cli-anything-pocketbase --json backups restore nightly.zip --yes"],
    "files url": ["cli-anything-pocketbase --json files url users RECORD_ID avatar.png --with-token"],
    "raw": ["cli-anything-pocketbase --json raw GET /api/health"],
}
_REPL_USAGE_MESSAGES = {
    "root": "Usage: settings|logs|crons|collections|records|batch|files|backups|raw ...",
    "auth.group": "Usage: auth <login|logout|status|whoami|refresh> ...",
    "auth.login": "Usage: auth login [--base-url <url>] [--collection <name>] [--password-stdin] <identity> [password]",
    "settings.group": "Usage: settings <get|patch|test-s3|test-email|apple-client-secret> ...",
    "settings.patch": "Usage: settings patch (--data '{...}' | --file settings.json | --file - | --stdin-json)",
    "settings.summary": (
        "Usage: settings get | settings patch (--data '{...}' | --file settings.json | --file - | --stdin-json) | "
        "settings test-s3 (--data '{...}' | --file body.json | --file - | --stdin-json) | "
        "settings test-email (--data '{...}' | --file body.json | --file - | --stdin-json) | "
        "settings apple-client-secret (--data '{...}' | --file body.json | --file - | --stdin-json)"
    ),
    "logs.group": "Usage: logs <list|get|stats> ...",
    "logs.summary": "Usage: logs list [--page N] [--per-page N] [--filter X] [--sort X] [--all] | logs get <log_id> | logs stats [--filter X]",
    "crons.group": "Usage: crons <list|run> ...",
    "crons.summary": "Usage: crons list | crons run <job_id> --yes",
    "collections.group": "Usage: collections <list|get|create|update|ensure|delete|truncate|import|scaffolds> ...",
    "collections.update": "Usage: collections update <name_or_id> (--data '{...}' | --file collection.json | --file - | --stdin-json)",
    "collections.ensure": (
        "Usage: collections ensure (--data '{...}' | --file collection.json | --file - | --stdin-json) "
        "[--if-exists update|fail] [--if-missing create|fail] [--output summary|full]"
    ),
    "collections.summary": (
        "Usage: collections list [--page N] [--per-page N] [--filter X] [--sort X] [--all] | "
        "collections get <name_or_id> | collections create (--data '{...}' | --file collection.json | --file - | --stdin-json) | "
        "collections ensure (--data '{...}' | --file collection.json | --file - | --stdin-json) [--if-exists update|fail] [--if-missing create|fail] [--output summary|full] | "
        "collections update <name_or_id> (--data '{...}' | --file collection.json | --file - | --stdin-json) | "
        "collections delete <name_or_id> --yes | collections truncate <name_or_id> --yes | "
        "collections import (--data '{...}' | --file import.json | --file - | --stdin-json) | collections scaffolds"
    ),
    "records.group": (
        "Usage: records <auth-methods|auth-password|auth-oauth2|auth-refresh|request-otp|auth-otp|"
        "request-password-reset|confirm-password-reset|request-verification|confirm-verification|"
        "request-email-change|confirm-email-change|impersonate|list|get|create|update|delete|find|upsert|delete-by-filter> ..."
    ),
    "records.auth-password": (
        "Usage: records auth-password <collection> <identity> <password> "
        "[--identity-field X] [--fields X] [--expand X] [--mfa-id X] [--no-save]"
    ),
    "records.auth-oauth2": (
        "Usage: records auth-oauth2 <collection> --provider X --code X --redirect-url X "
        "[--code-verifier X] [--create-data '{...}' | --create-file create.json] "
        "[--fields X] [--expand X] [--no-save]"
    ),
    "records.auth-refresh": "Usage: records auth-refresh <collection> [--fields X] [--expand X] [--no-save]",
    "records.auth-otp": (
        "Usage: records auth-otp <collection> <otp_id> <password> "
        "[--fields X] [--expand X] [--mfa-id X] [--no-save]"
    ),
    "records.impersonate": (
        "Usage: records impersonate <collection> <record_id> "
        "[--duration N] [--fields X] [--expand X] [--no-save]"
    ),
    "records.list": "Usage: records list <collection> [--page N] [--per-page N] [--filter X] [--sort X] [--fields X] [--expand X] [--all]",
    "records.get": "Usage: records get <collection> <record_id> [--fields X] [--expand X]",
    "records.create": "Usage: records create <collection> (--data '{...}' | --file record.json | --file - | --stdin-json)",
    "records.update": "Usage: records update <collection> <record_id> (--data '{...}' | --file record.json | --file - | --stdin-json)",
    "records.summary": (
        "Usage: records auth-methods <collection> | "
        "records auth-password <collection> <identity> <password> [--identity-field X] [--fields X] [--expand X] [--mfa-id X] [--no-save] | "
        "records auth-oauth2 <collection> --provider X --code X --redirect-url X [--code-verifier X] [--create-data '{...}' | --create-file create.json] [--fields X] [--expand X] [--no-save] | "
        "records auth-refresh <collection> [--fields X] [--expand X] [--no-save] | "
        "records request-otp <collection> <email> | "
        "records auth-otp <collection> <otp_id> <password> [--fields X] [--expand X] [--mfa-id X] [--no-save] | "
        "records request-password-reset <collection> <email> | "
        "records confirm-password-reset <collection> <token> <password> <password_confirm> | "
        "records request-verification <collection> <email> | "
        "records confirm-verification <collection> <token> | "
        "records request-email-change <collection> <new_email> | "
        "records confirm-email-change <collection> <token> <password> | "
        "records impersonate <collection> <record_id> [--duration N] [--fields X] [--expand X] [--no-save] | "
        "records list <collection> [--page N] [--per-page N] [--filter X] [--sort X] [--fields X] [--expand X] [--all] | "
        "records get <collection> <record_id> [--fields X] [--expand X] | "
        "records create <collection> (--data '{...}' | --file record.json | --file - | --stdin-json) | "
        "records update <collection> <record_id> (--data '{...}' | --file record.json | --file - | --stdin-json) | "
        "records delete <collection> <record_id> --yes | "
        "records find <collection> --filter X [--first] [--per-page N] [--sort X] [--fields X] [--expand X] | "
        "records upsert <collection> --filter X (--data '{...}' | --file record.json | --file - | --stdin-json) [--first] [--fields X] [--expand X] | "
        "records delete-by-filter <collection> --filter X [--expect-count N] --yes"
    ),
    "files.group": "Usage: files <token|url> ...",
    "files.url": "Usage: files url <collection> <record_id> <filename> [--thumb X] [--download] [--token X] [--with-token]",
    "files.summary": "Usage: files token | files url <collection> <record_id> <filename> [--thumb X] [--download] [--token X] [--with-token]",
    "batch.group": "Usage: batch run (--data '{...}' | --file requests.json | --file - | --stdin-json)",
    "backups.group": "Usage: backups <list|create|upload|delete|download|restore> ...",
    "backups.download": "Usage: backups download <name> [--output PATH] [--token X] [--overwrite]",
    "backups.restore": "Usage: backups restore <name> --yes",
    "backups.summary": (
        "Usage: backups list | backups create [--name NAME] | backups upload <file_path> | "
        "backups delete <name> --yes | backups download <name> [--output PATH] [--token X] [--overwrite] | "
        "backups restore <name> --yes"
    ),
    "raw": "Usage: raw <METHOD> <PATH> [--data '{...}' | --file body.json | --file - | --stdin-json]",
}

RemoteOperation = Callable[[PocketBaseRemoteClient], RemoteResult]


def _normalize_schema_path(path: str) -> str:
    normalized = path.strip().replace(".", " ")
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.lower()


def _serialize_param(param: click.Parameter) -> dict[str, Any]:
    def safe_default(value: Any) -> Any:
        if value in (None, (), []):
            return None
        if value.__class__.__name__ == "Sentinel":
            return None
        if isinstance(value, (str, int, float, bool)):
            return value
        if isinstance(value, Path):
            return str(value)
        if isinstance(value, (list, tuple)):
            rendered = [safe_default(item) for item in value]
            return [item for item in rendered if item is not None]
        if isinstance(value, dict):
            return {str(key): safe_default(item) for key, item in value.items()}
        return str(value)

    if isinstance(param, click.Argument):
        return {
            "kind": "argument",
            "name": param.name,
            "nargs": param.nargs,
            "required": getattr(param, "required", True),
            "type": str(param.type),
        }

    if isinstance(param, click.Option):
        option_names = [*param.opts, *param.secondary_opts]
        default_value = None if callable(param.default) else safe_default(param.default)
        return {
            "kind": "option",
            "name": option_names[0] if option_names else f"--{param.name.replace('_', '-')}",
            "aliases": option_names[1:],
            "names": option_names,
            "required": param.required,
            "takes_value": not param.is_flag,
            "is_flag": param.is_flag,
            "multiple": param.multiple,
            "nargs": param.nargs,
            "default": default_value,
            "help": param.help or "",
            "type": str(param.type),
        }

    return {"kind": "parameter", "name": param.name}


def _schema_output_path(path_tokens: list[str]) -> str:
    return ".".join(path_tokens) if path_tokens else "root"


def _format_schema_entry(entry: dict[str, Any]) -> dict[str, Any]:
    parameters = list(entry.get("parameters") or [])
    arguments = [item for item in parameters if item.get("kind") == "argument"]
    options = [item for item in parameters if item.get("kind") == "option"]

    formatted = dict(entry)
    formatted["arguments"] = arguments
    formatted["options"] = options
    formatted["dangerous"] = bool(entry.get("destructive"))
    return formatted


def _infer_auth_requirement(path: str, *, kind: str) -> bool | str:
    if kind == "root":
        return "varies"
    if kind == "group":
        if path in {"settings", "logs", "crons", "collections", "backups", "batch"}:
            return True
        if path in {"config"}:
            return False
        return "varies"

    if path in {
        "repl",
        "info",
        "raw",
        "schema",
        "undo",
        "redo",
        "history",
        "config show",
        "config set",
        "config unset",
        "auth login",
        "auth logout",
        "auth status",
        "auth whoami",
    }:
        return False

    if path == "files url":
        return "conditional"

    if path in {
        "records auth-methods",
        "records auth-password",
        "records auth-oauth2",
        "records request-otp",
        "records auth-otp",
        "records request-password-reset",
        "records confirm-password-reset",
        "records request-verification",
        "records confirm-verification",
        "records confirm-email-change",
    }:
        return False

    if path.startswith("records "):
        return True

    if path.startswith("settings "):
        return True
    if path.startswith("logs "):
        return True
    if path.startswith("crons "):
        return True
    if path.startswith("collections "):
        return True
    if path.startswith("files "):
        return True
    if path.startswith("backups "):
        return True
    if path.startswith("batch "):
        return True
    if path == "auth refresh":
        return True

    return "unknown"


def _infer_confirmation(path: str) -> tuple[bool, str | None]:
    if path in {
        "backups delete",
        "backups restore",
        "collections delete",
        "collections truncate",
        "crons run",
        "records delete",
        "records delete-by-filter",
    }:
        return True, "--yes"
    return False, None


def _infer_destructive(path: str) -> bool:
    return path in {
        "crons run",
        "records delete",
        "records delete-by-filter",
        "collections delete",
        "collections truncate",
        "backups delete",
        "backups restore",
    }


def _collect_schema_entries(*, include_hidden: bool) -> dict[str, dict[str, Any]]:
    entries: dict[str, dict[str, Any]] = {}

    def visit(command: click.Command, path_tokens: list[str]) -> None:
        if command.hidden and not include_hidden:
            return

        normalized_path = _normalize_schema_path(" ".join(path_tokens))
        kind = "group" if isinstance(command, click.Group) else "command"
        if not path_tokens:
            kind = "root"

        children: list[str] = []
        if isinstance(command, click.Group):
            for child_name, child_command in sorted(command.commands.items()):
                if child_command.hidden and not include_hidden:
                    continue
                child_path = [*path_tokens, child_name]
                children.append(_schema_output_path(child_path))
                visit(child_command, child_path)

        confirmation_required, confirmation_flag = _infer_confirmation(normalized_path)
        serialized_parameters = [_serialize_param(param) for param in command.params]
        entry = {
            "name": command.name or "root",
            "path": _schema_output_path(path_tokens),
            "kind": kind,
            "summary": command.help or "",
            "hidden": bool(command.hidden),
            "auth_required": _infer_auth_requirement(normalized_path, kind=kind),
            "destructive": _infer_destructive(normalized_path),
            "confirmation_required": confirmation_required,
            "confirmation_flag": confirmation_flag,
            "examples": _SCHEMA_EXAMPLES.get(normalized_path, []),
            "parameters": serialized_parameters,
            "children": children,
        }
        entries[normalized_path] = entry

    visit(cli, [])
    return entries


def _schema_contract(*, include_hidden: bool) -> dict[str, Any]:
    entries = _collect_schema_entries(include_hidden=include_hidden)
    ordered_paths = sorted(path for path in entries if path)
    root_entry = _format_schema_entry(entries[""])
    commands = [_format_schema_entry(entries[path]) for path in ordered_paths]
    return {
        "schema_version": _SCHEMA_VERSION,
        "tool": "cli-anything-pocketbase",
        "mode": "remote-only",
        "global_options": [
            {
                "name": "--json",
                "summary": "Emit machine-readable JSON output for command result payloads.",
            }
        ],
        "query_format": "schema <command path> --json",
        "root": root_entry,
        "commands": commands,
        "entries": [root_entry, *commands],
    }


def _build_context(*, json_output: bool) -> dict[str, Any]:
    store = SessionStore()
    state = store.load()

    return {
        "json_output": json_output,
        "store": store,
        "state": state,
    }


def _save_state(ctx: click.Context) -> None:
    ctx.obj["store"].save(ctx.obj["state"])


def _record_command(ctx: click.Context, command_line: str) -> None:
    ctx.obj["state"].record_command(command_line)
    _save_state(ctx)


def _redact_command(parts: list[str], sensitive_indexes: set[int] | None = None) -> str:
    if not sensitive_indexes:
        return " ".join(parts)

    rendered: list[str] = []
    for index, part in enumerate(parts):
        rendered.append("********" if index in sensitive_indexes else part)
    return " ".join(rendered)


def _resolve_base_url(ctx: click.Context, base_url: str | None = None) -> str | None:
    resolved = base_url or ctx.obj["state"].remote_auth.get("base_url") or ctx.obj["state"].config.get("base_url")
    if not resolved:
        return None
    return str(resolved).rstrip("/")


def _resolve_auth_collection(ctx: click.Context, collection: str | None = None) -> str:
    resolved = (
        collection
        or ctx.obj["state"].remote_auth.get("collection")
        or ctx.obj["state"].config.get("auth_collection")
        or "_superusers"
    )
    return str(resolved)


def _build_remote_client(
    ctx: click.Context,
    *,
    require_auth: bool = True,
    base_url: str | None = None,
    collection: str | None = None,
) -> PocketBaseRemoteClient:
    resolved_base_url = _resolve_base_url(ctx, base_url)
    if not resolved_base_url:
        emit_error(
            json_output=ctx.obj["json_output"],
            action="remote",
            message="Remote base URL is not configured. Run `config set base_url <url>` or `auth login --base-url <url>` first.",
            error_type="missing_prerequisite",
            hint="Set a base URL with `config set base_url <url>` or pass `auth login --base-url <url>`.",
            missing_prerequisite="base_url",
        )

    token = ctx.obj["state"].remote_auth.get("token")
    if require_auth and not token:
        emit_error(
            json_output=ctx.obj["json_output"],
            action="remote",
            message="Remote auth token is missing. Run `auth login` first.",
            error_type="missing_prerequisite",
            hint="Authenticate with `auth login` before invoking remote admin endpoints.",
            missing_prerequisite="auth_login",
        )

    return PocketBaseRemoteClient(
        base_url=resolved_base_url,
        token=token,
        collection=_resolve_auth_collection(ctx, collection),
        timeout=ctx.obj["state"].config.get("timeout"),
    )


def _require_base_url(
    ctx: click.Context,
    *,
    action: str,
    base_url: str | None = None,
    message: str = _RECORD_BASE_URL_REQUIRED_MESSAGE,
) -> str:
    resolved_base_url = _resolve_base_url(ctx, base_url)
    if not resolved_base_url:
        emit_error(
            json_output=ctx.obj["json_output"],
            action=action,
            message=message,
            error_type="missing_prerequisite",
            hint="Persist a PocketBase base URL with `config set base_url <url>` or provide it explicitly.",
            missing_prerequisite="base_url",
        )
    return resolved_base_url


def _require_confirmation(
    ctx: click.Context,
    *,
    action: str,
    yes: bool,
    message: str,
    hint: str,
) -> bool:
    if yes:
        return True
    emit_error(
        json_output=ctx.obj["json_output"],
        action=action,
        message=message,
        error_type="confirmation_required",
        hint=hint,
    )
    return False


def _emit_repl_usage(ctx: click.Context, *, action: str, usage_key: str) -> None:
    emit_error(
        json_output=ctx.obj["json_output"],
        action=action,
        message=_REPL_USAGE_MESSAGES[usage_key],
    )


def _render_remote_result(
    ctx: click.Context,
    *,
    action: str,
    result: RemoteResult,
    success_message: str,
) -> None:
    emit_success(
        json_output=ctx.obj["json_output"],
        action=action,
        message=success_message,
        data=result.to_dict(),
    )


def _parse_json_object(raw: str) -> dict[str, Any]:
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON body: {exc}") from exc

    if not isinstance(payload, dict):
        raise ValueError("JSON body must be an object")

    return payload


def _parse_json_file_object(path: str) -> dict[str, Any]:
    try:
        raw = Path(path).read_text(encoding="utf-8")
    except OSError as exc:
        raise ValueError(f"Failed to read JSON file: {exc}") from exc

    return _parse_json_object(raw)


def _read_stdin_text(*, action: str) -> str:
    raw = click.get_text_stream("stdin").read()
    if not raw.strip():
        raise ValueError(f"{action} expected JSON input on stdin.")
    return raw


def _read_secret_from_stdin(*, action: str) -> str:
    raw = click.get_text_stream("stdin").read()
    value = raw.rstrip("\r\n")
    if not value:
        raise ValueError(f"{action} expected secret input on stdin.")
    return value


def _load_text_input(
    *,
    data: str | None,
    file_path: str | None,
    stdin_json: bool,
    action: str,
    required: bool,
) -> str | None:
    file_is_stdin = file_path == "-"
    explicit_file_path = file_path if file_path not in {None, "-"} else None
    provided_sources = int(data is not None) + int(explicit_file_path is not None) + int(stdin_json or file_is_stdin)

    if required and provided_sources != 1:
        raise ValueError(f"{action} requires exactly one of `--data`, `--file`, or `--stdin-json`.")
    if not required and provided_sources > 1:
        raise ValueError(f"{action} accepts at most one of `--data`, `--file`, or `--stdin-json`.")
    if provided_sources == 0:
        return None
    if stdin_json or file_is_stdin:
        return _read_stdin_text(action=action)
    if explicit_file_path:
        try:
            return Path(explicit_file_path).read_text(encoding="utf-8")
        except OSError as exc:
            raise ValueError(f"Failed to read JSON file: {exc}") from exc
    return data or ""


def _load_json_object_input(
    *,
    data: str | None,
    file_path: str | None,
    stdin_json: bool = False,
    action: str,
) -> dict[str, Any]:
    raw = _load_text_input(
        data=data,
        file_path=file_path,
        stdin_json=stdin_json,
        action=action,
        required=True,
    )
    return _parse_json_object(raw or "")


def _load_optional_json_object_input(
    *,
    data: str | None,
    file_path: str | None,
    stdin_json: bool = False,
    action: str,
) -> dict[str, Any] | None:
    raw = _load_text_input(
        data=data,
        file_path=file_path,
        stdin_json=stdin_json,
        action=action,
        required=False,
    )
    if raw is None:
        return None
    return _parse_json_object(raw)


def _parse_collections_import_payload(payload: dict[str, Any]) -> dict[str, Any]:
    collections = payload.get("collections")
    if not isinstance(collections, list) or not collections:
        raise ValueError("Collections import payload must contain a non-empty `collections` array")
    return payload


def _parse_collection_ensure_payload(payload: dict[str, Any]) -> tuple[dict[str, Any], str]:
    name = payload.get("name")
    if not isinstance(name, str) or not name.strip():
        raise ValueError("collections.ensure payload must include a non-empty `name`")
    normalized_name = name.strip()
    payload["name"] = normalized_name
    return payload, normalized_name


def _parse_settings_s3_test_payload(payload: dict[str, Any]) -> dict[str, Any]:
    filesystem = payload.get("filesystem")
    if filesystem not in {"storage", "backups"}:
        raise ValueError("Settings S3 test payload must include `filesystem` set to `storage` or `backups`")
    return payload


def _parse_settings_email_test_payload(payload: dict[str, Any]) -> dict[str, Any]:
    email = payload.get("email")
    template = payload.get("template")
    if not isinstance(email, str) or not email.strip():
        raise ValueError("Settings email test payload must include a non-empty `email`")
    if not isinstance(template, str) or not template.strip():
        raise ValueError("Settings email test payload must include a non-empty `template`")
    return payload


def _parse_apple_secret_payload(payload: dict[str, Any]) -> dict[str, Any]:
    required = {"clientId", "teamId", "keyId", "privateKey", "duration"}
    missing = [key for key in required if key not in payload]
    if missing:
        raise ValueError(f"Apple client secret payload is missing required keys: {', '.join(sorted(missing))}")
    return payload


def _parse_batch_payload(payload: dict[str, Any]) -> dict[str, Any]:
    requests = payload.get("requests")
    if not isinstance(requests, list) or not requests:
        raise ValueError("Batch payload must contain a non-empty `requests` array")

    for index, item in enumerate(requests):
        if not isinstance(item, dict):
            raise ValueError(f"Batch request {index} must be an object")

        method = item.get("method")
        url = item.get("url")
        if not isinstance(method, str) or not method.strip():
            raise ValueError(f"Batch request {index} must include a string `method`")
        if not isinstance(url, str) or not url.strip():
            raise ValueError(f"Batch request {index} must include a string `url`")

        normalized_method = method.strip().upper()
        pattern = _BATCH_ALLOWED_PATTERNS.get(normalized_method)
        if pattern is None or not pattern.match(url.strip()):
            raise ValueError(
                "Batch request {index} must target one of the supported record actions: "
                "POST/PUT /api/collections/<collection>/records, "
                "PATCH/DELETE /api/collections/<collection>/records/<id>".format(index=index)
            )

        body = item.get("body")
        if body is not None and not isinstance(body, dict):
            raise ValueError(f"Batch request {index} `body` must be a JSON object when provided")

        headers = item.get("headers")
        if headers is not None:
            if not isinstance(headers, dict):
                raise ValueError(f"Batch request {index} `headers` must be an object when provided")
            invalid_header = next(
                (key for key, value in headers.items() if not isinstance(key, str) or not isinstance(value, str)),
                None,
            )
            if invalid_header is not None:
                raise ValueError(f"Batch request {index} `headers` keys and values must be strings")

    return payload


def _handle_remote_error(ctx: click.Context, *, action: str, error: PocketBaseRemoteError) -> None:
    emit_error(
        json_output=ctx.obj["json_output"],
        action=action,
        message=str(error),
        code=error.status or 1,
        data=error.to_dict(),
    )


def _call_remote(
    ctx: click.Context,
    *,
    action: str,
    operation: RemoteOperation,
    require_auth: bool = True,
    base_url: str | None = None,
    collection: str | None = None,
) -> tuple[PocketBaseRemoteClient, RemoteResult] | None:
    client = _build_remote_client(
        ctx,
        require_auth=require_auth,
        base_url=base_url,
        collection=collection,
    )
    try:
        result = operation(client)
    except PocketBaseRemoteError as exc:
        _handle_remote_error(ctx, action=action, error=exc)
        return None
    return client, result


def _run_remote_action(
    ctx: click.Context,
    *,
    action: str,
    success_message: str,
    operation: RemoteOperation,
    require_auth: bool = True,
    base_url: str | None = None,
    collection: str | None = None,
) -> None:
    invocation = _call_remote(
        ctx,
        action=action,
        operation=operation,
        require_auth=require_auth,
        base_url=base_url,
        collection=collection,
    )
    if invocation is None:
        return

    _, result = invocation
    _render_remote_result(
        ctx,
        action=action,
        result=result,
        success_message=success_message,
    )


def _extract_auth_payload(result: RemoteResult, *, action: str) -> dict[str, Any]:
    payload = result.data if isinstance(result.data, dict) else {}
    token = payload.get("token")
    record = payload.get("record")

    if not isinstance(token, str) or not token.strip():
        raise ValueError(f"{action} response did not include a usable token")

    if record is not None and not isinstance(record, dict):
        raise ValueError(f"{action} response contained an invalid record payload")

    return {
        "token": token,
        "record": record or {},
    }


def _extract_mfa_payload(result: RemoteResult, *, action: str) -> dict[str, Any]:
    payload = result.data if isinstance(result.data, dict) else {}
    mfa_id = payload.get("mfaId")

    if result.status != 401:
        raise ValueError(f"{action} did not return an MFA challenge")

    if not isinstance(mfa_id, str) or not mfa_id.strip():
        raise ValueError(f"{action} MFA challenge did not include a usable mfaId")

    return {
        "mfaId": mfa_id,
    }


def _save_auth_result(
    ctx: click.Context,
    *,
    result: RemoteResult,
    action: str,
    base_url: str,
    collection: str,
) -> bool:
    try:
        payload = _extract_auth_payload(result, action=action)
    except ValueError as exc:
        emit_error(
            json_output=ctx.obj["json_output"],
            action=action.replace(" ", "."),
            message=str(exc),
            data=result.to_dict(),
        )
        return False

    ctx.obj["state"].set_remote_auth(
        base_url=base_url,
        token=payload["token"],
        record=payload["record"],
        collection=collection,
    )
    _save_state(ctx)
    return True


def _render_auth_or_mfa_result(
    ctx: click.Context,
    *,
    action: str,
    result: RemoteResult,
    success_message: str,
    mfa_message: str,
    base_url: str,
    collection: str,
    save_auth: bool,
) -> None:
    if result.status == 401:
        try:
            payload = _extract_mfa_payload(result, action=action.replace(".", " "))
        except ValueError as exc:
            emit_error(
                json_output=ctx.obj["json_output"],
                action=action,
                message=str(exc),
                data=result.to_dict(),
            )
            return

        emit_success(
            json_output=ctx.obj["json_output"],
            action=action,
            message=mfa_message,
            data={
                **result.to_dict(),
                "mfaId": payload["mfaId"],
                "mfa_required": True,
                "saved": False,
            },
        )
        return

    if save_auth and not _save_auth_result(
        ctx,
        result=result,
        action=action.replace(".", " "),
        base_url=base_url,
        collection=collection,
    ):
        return

    _render_remote_result(
        ctx,
        action=action,
        result=result,
        success_message=success_message,
    )


def _resolve_file_token(
    ctx: click.Context,
    *,
    action: str,
    client: PocketBaseRemoteClient,
) -> str | None:
    invocation = _call_remote(
        ctx,
        action=action,
        operation=lambda active_client: active_client.files_token(),
        require_auth=True,
        base_url=client.base_url,
        collection=client.collection,
    )
    if invocation is None:
        return None

    _, result = invocation
    payload = result.data if isinstance(result.data, dict) else {}
    token_value = payload.get("token")
    if not isinstance(token_value, str) or not token_value.strip():
        emit_error(
            json_output=ctx.obj["json_output"],
            action=action,
            message=_FILE_TOKEN_RESPONSE_ERROR_MESSAGE,
            data=result.to_dict(),
        )
    return token_value


def _extract_paginated_payload(result: RemoteResult, *, action: str) -> dict[str, Any]:
    payload = result.data if isinstance(result.data, dict) else {}
    items = payload.get("items")
    if not isinstance(items, list):
        raise ValueError(f"{action} did not return a paginated `items` payload")
    return payload


def _fetch_all_pages(
    *,
    action: str,
    per_page: int | None,
    fetch_page: Callable[[int, int], RemoteResult],
) -> RemoteResult:
    page_size = max(per_page or _DEFAULT_ALL_PER_PAGE, 1)
    page = 1
    fetched_pages = 0
    all_items: list[Any] = []
    total_items: int | None = None
    last_result: RemoteResult | None = None

    while True:
        result = fetch_page(page, page_size)
        payload = _extract_paginated_payload(result, action=action)
        page_items = payload.get("items") or []
        total_items_value = payload.get("totalItems")
        total_pages_value = payload.get("totalPages")
        last_result = result
        fetched_pages += 1
        all_items.extend(page_items)

        if isinstance(total_items_value, int):
            total_items = total_items_value
            if len(all_items) >= total_items_value:
                break

        if isinstance(total_pages_value, int) and page >= total_pages_value:
            break

        if not page_items:
            break

        page += 1

    if last_result is None:
        raise ValueError(f"{action} did not return any pages")

    return RemoteResult(
        method=last_result.method,
        url=last_result.url,
        status=last_result.status,
        data={
            "page": 1,
            "perPage": len(all_items) or page_size,
            "totalItems": total_items if total_items is not None else len(all_items),
            "totalPages": 1,
            "items": all_items,
            "fetchedAll": True,
            "fetchedPages": fetched_pages,
            "nextPage": None,
        },
    )


def _probe_health(ctx: click.Context) -> dict[str, Any] | None:
    resolved_base_url = _resolve_base_url(ctx)
    if not resolved_base_url:
        return None

    client = PocketBaseRemoteClient(
        base_url=resolved_base_url,
        token=ctx.obj["state"].remote_auth.get("token"),
        collection=_resolve_auth_collection(ctx),
        timeout=ctx.obj["state"].config.get("timeout"),
    )
    try:
        result = client.raw(method="GET", path="/api/health", require_auth=False)
    except PocketBaseRemoteError as exc:
        return {
            "ok": False,
            "message": str(exc),
            "status": exc.status,
            "url": exc.url,
        }

    return {
        "ok": True,
        "status": result.status,
        "data": result.data,
    }


def _handle_info(ctx: click.Context, *, record_history: bool = True) -> None:
    if record_history:
        _record_command(ctx, "info")

    remote_auth = ctx.obj["state"].remote_auth
    payload = {
        "mode": "remote",
        "active_config": ctx.obj["state"].config,
        "resolved_base_url": _resolve_base_url(ctx),
        "resolved_auth_collection": _resolve_auth_collection(ctx),
        "remote_auth": {
            "authenticated": ctx.obj["state"].has_remote_auth(),
            "base_url": remote_auth.get("base_url"),
            "collection": remote_auth.get("collection"),
            "record": remote_auth.get("record"),
        },
        "health": _probe_health(ctx),
    }

    emit_success(
        json_output=ctx.obj["json_output"],
        action="info",
        message="PocketBase remote harness info",
        data=payload,
    )


def _handle_auth_login(
    ctx: click.Context,
    *,
    base_url: str | None,
    identity: str,
    password: str,
    collection: str | None = None,
    record_history: bool = True,
) -> None:
    resolved_base_url = _require_base_url(
        ctx,
        action="auth.login",
        base_url=base_url,
        message=_LOGIN_BASE_URL_REQUIRED_MESSAGE,
    )
    resolved_collection = str(collection or ctx.obj["state"].config.get("auth_collection") or "_superusers")

    if record_history:
        history_parts = ["auth", "login"]
        if base_url:
            history_parts.extend(["--base-url", base_url])
        if collection:
            history_parts.extend(["--collection", collection])
        history_parts.extend([identity, password])
        _record_command(ctx, _redact_command(history_parts, {len(history_parts) - 1}))

    invocation = _call_remote(
        ctx,
        action="auth.login",
        operation=lambda client: client.login(identity=identity, password=password),
        require_auth=False,
        base_url=resolved_base_url,
        collection=resolved_collection,
    )
    if invocation is None:
        return
    _, result = invocation

    if not _save_auth_result(
        ctx,
        result=result,
        action="auth login",
        base_url=resolved_base_url,
        collection=resolved_collection,
    ):
        return
    _render_remote_result(ctx, action="auth.login", result=result, success_message="Remote auth login completed")


def _auth_status_payload(ctx: click.Context) -> dict[str, Any]:
    remote_auth = ctx.obj["state"].remote_auth
    return {
        "authenticated": ctx.obj["state"].has_remote_auth(),
        "configured_base_url": ctx.obj["state"].config.get("base_url"),
        "configured_auth_collection": ctx.obj["state"].config.get("auth_collection", "_superusers"),
        "active_base_url": remote_auth.get("base_url"),
        "active_collection": remote_auth.get("collection"),
        "record": remote_auth.get("record"),
    }


def _handle_auth_logout(ctx: click.Context, *, record_history: bool = True) -> None:
    if record_history:
        _record_command(ctx, "auth logout")
    ctx.obj["state"].clear_remote_auth()
    _save_state(ctx)
    emit_success(
        json_output=ctx.obj["json_output"],
        action="auth.logout",
        message="Remote auth cleared",
        data={"authenticated": False},
    )


def _handle_auth_status(ctx: click.Context, *, record_history: bool = True) -> None:
    if record_history:
        _record_command(ctx, "auth status")

    emit_success(
        json_output=ctx.obj["json_output"],
        action="auth.status",
        message="Remote auth status",
        data=_auth_status_payload(ctx),
    )


def _handle_auth_whoami(ctx: click.Context, *, record_history: bool = True) -> None:
    if record_history:
        _record_command(ctx, "auth whoami")

    emit_success(
        json_output=ctx.obj["json_output"],
        action="auth.whoami",
        message="Current remote auth identity",
        data=_auth_status_payload(ctx),
    )


def _handle_auth_refresh(ctx: click.Context, *, record_history: bool = True) -> None:
    if record_history:
        _record_command(ctx, "auth refresh")

    invocation = _call_remote(
        ctx,
        action="auth.refresh",
        operation=lambda client: client.refresh(),
        require_auth=True,
    )
    if invocation is None:
        return
    client, result = invocation

    if not _save_auth_result(
        ctx,
        result=result,
        action="auth refresh",
        base_url=client.base_url,
        collection=client.collection,
    ):
        return
    _render_remote_result(ctx, action="auth.refresh", result=result, success_message="Remote auth refreshed")


def _handle_collections_list(
    ctx: click.Context,
    *,
    page: int | None,
    per_page: int | None,
    filter_value: str | None,
    sort: str | None,
    all_pages: bool = False,
    record_history: bool = True,
) -> None:
    if record_history:
        _record_command(ctx, "collections list")
    action = "collections.list"
    operation: RemoteOperation
    if all_pages:
        operation = lambda client: _fetch_all_pages(
            action=action,
            per_page=per_page,
            fetch_page=lambda current_page, current_per_page: client.collections_list(
                page=current_page,
                per_page=current_per_page,
                filter_value=filter_value,
                sort=sort,
            ),
        )
    else:
        operation = lambda client: client.collections_list(
            page=page,
            per_page=per_page,
            filter_value=filter_value,
            sort=sort,
        )
    _run_remote_action(
        ctx,
        action=action,
        success_message="Collections list completed",
        operation=operation,
    )


def _handle_collections_get(
    ctx: click.Context,
    *,
    name_or_id: str,
    record_history: bool = True,
) -> None:
    if record_history:
        _record_command(ctx, f"collections get {name_or_id}")
    _run_remote_action(
        ctx,
        action="collections.get",
        success_message="Collection fetch completed",
        operation=lambda client: client.collections_get(name_or_id),
    )


def _handle_collections_create(
    ctx: click.Context,
    *,
    data: str | None,
    file_path: str | None,
    stdin_json: bool = False,
    record_history: bool = True,
) -> None:
    if record_history:
        if file_path == "-":
            _record_command(ctx, "collections create --file -")
        elif stdin_json:
            _record_command(ctx, "collections create --stdin-json")
        else:
            _record_command(ctx, "collections create --data <json>" if data else "collections create --file <path>")

    try:
        body = _load_json_object_input(
            data=data,
            file_path=file_path,
            stdin_json=stdin_json,
            action="collections.create",
        )
    except ValueError as exc:
        emit_error(
            json_output=ctx.obj["json_output"],
            action="collections.create",
            message=str(exc),
        )
        return

    _run_remote_action(
        ctx,
        action="collections.create",
        success_message="Collection create completed",
        operation=lambda client: client.collections_create(body=body),
    )


def _handle_collections_update(
    ctx: click.Context,
    *,
    name_or_id: str,
    data: str | None,
    file_path: str | None,
    stdin_json: bool = False,
    record_history: bool = True,
) -> None:
    if record_history:
        if file_path == "-":
            _record_command(ctx, f"collections update {name_or_id} --file -")
        elif stdin_json:
            _record_command(ctx, f"collections update {name_or_id} --stdin-json")
        else:
            _record_command(
                ctx,
                f"collections update {name_or_id} --data <json>" if data else f"collections update {name_or_id} --file <path>",
            )

    try:
        body = _load_json_object_input(
            data=data,
            file_path=file_path,
            stdin_json=stdin_json,
            action="collections.update",
        )
    except ValueError as exc:
        emit_error(
            json_output=ctx.obj["json_output"],
            action="collections.update",
            message=str(exc),
        )
        return

    _run_remote_action(
        ctx,
        action="collections.update",
        success_message="Collection update completed",
        operation=lambda client: client.collections_update(name_or_id=name_or_id, body=body),
    )


def _handle_collections_ensure(
    ctx: click.Context,
    *,
    data: str | None,
    file_path: str | None,
    stdin_json: bool = False,
    if_exists: str = "update",
    if_missing: str = "create",
    output_mode: str = "full",
    record_history: bool = True,
) -> None:
    if record_history:
        if file_path == "-":
            history_parts = ["collections", "ensure", "--file", "-"]
        elif stdin_json:
            history_parts = ["collections", "ensure", "--stdin-json"]
        else:
            history_parts = ["collections", "ensure", "--data", "<json>"] if data else ["collections", "ensure", "--file", "<path>"]
        if if_exists != "update":
            history_parts.extend(["--if-exists", if_exists])
        if if_missing != "create":
            history_parts.extend(["--if-missing", if_missing])
        if output_mode != "full":
            history_parts.extend(["--output", output_mode])
        _record_command(ctx, " ".join(history_parts))

    try:
        body = _load_json_object_input(
            data=data,
            file_path=file_path,
            stdin_json=stdin_json,
            action="collections.ensure",
        )
        body, lookup_name = _parse_collection_ensure_payload(body)
    except ValueError as exc:
        emit_error(
            json_output=ctx.obj["json_output"],
            action="collections.ensure",
            message=str(exc),
        )
        return

    client = _build_remote_client(ctx, require_auth=True)
    matched: dict[str, Any] | None = None

    try:
        existing = client.collections_get(lookup_name)
        if isinstance(existing.data, dict):
            matched = existing.data

        if if_exists == "fail":
            emit_error(
                json_output=ctx.obj["json_output"],
                action="collections.ensure",
                message=f"Collection `{lookup_name}` already exists and `--if-exists fail` was requested.",
                error_type="invalid_input",
                hint="Remove `--if-exists fail` to update the collection, or use `collections update` explicitly.",
                data={
                    "lookup_name": lookup_name,
                    "matched": matched,
                    "if_exists": if_exists,
                },
            )
            return

        result = client.collections_update(name_or_id=lookup_name, body=body)
        operation = "update"
    except PocketBaseRemoteError as exc:
        if exc.status != 404:
            _handle_remote_error(ctx, action="collections.ensure", error=exc)
            return

        if if_missing == "fail":
            emit_error(
                json_output=ctx.obj["json_output"],
                action="collections.ensure",
                message=f"Collection `{lookup_name}` does not exist and `--if-missing fail` was requested.",
                error_type="not_found",
                hint="Remove `--if-missing fail` to create the collection, or create it explicitly with `collections create`.",
                data={
                    "lookup_name": lookup_name,
                    "if_missing": if_missing,
                },
                http_status=404,
            )
            return

        try:
            result = client.collections_create(body=body)
        except PocketBaseRemoteError as create_exc:
            _handle_remote_error(ctx, action="collections.ensure", error=create_exc)
            return
        operation = "create"

    result_payload = result.data if isinstance(result.data, dict) else {}
    if output_mode == "summary":
        summary_payload = {
            "operation": operation,
            "lookup_name": lookup_name,
            "existed": matched is not None,
            "status": result.status,
            "collection": {
                "id": result_payload.get("id"),
                "name": result_payload.get("name"),
                "type": result_payload.get("type"),
            },
            "field_count": len(result_payload.get("fields")) if isinstance(result_payload.get("fields"), list) else None,
            "policies": {
                "if_exists": if_exists,
                "if_missing": if_missing,
            },
            "output": output_mode,
        }
        emit_success(
            json_output=ctx.obj["json_output"],
            action="collections.ensure",
            message="Collection ensure completed",
            data=summary_payload,
        )
        return

    emit_success(
        json_output=ctx.obj["json_output"],
        action="collections.ensure",
        message="Collection ensure completed",
        data={
            "operation": operation,
            "lookup_name": lookup_name,
            "matched": matched,
            "if_exists": if_exists,
            "if_missing": if_missing,
            "output": output_mode,
            "data": result.data,
            "method": result.method,
            "url": result.url,
            "status": result.status,
        },
    )


def _handle_collections_delete(
    ctx: click.Context,
    *,
    name_or_id: str,
    yes: bool,
    record_history: bool = True,
) -> None:
    if not _require_confirmation(
        ctx,
        action="collections.delete",
        yes=yes,
        message="Collection delete is destructive. Re-run with `--yes` to continue.",
        hint="Re-run `collections delete <name_or_id> --yes` once you have verified the target collection.",
    ):
        return
    if record_history:
        _record_command(ctx, f"collections delete {name_or_id} --yes")
    _run_remote_action(
        ctx,
        action="collections.delete",
        success_message="Collection delete completed",
        operation=lambda client: client.collections_delete(name_or_id),
    )


def _handle_collections_truncate(
    ctx: click.Context,
    *,
    name_or_id: str,
    yes: bool,
    record_history: bool = True,
) -> None:
    if not _require_confirmation(
        ctx,
        action="collections.truncate",
        yes=yes,
        message="Collection truncate is destructive. Re-run with `--yes` to continue.",
        hint="Re-run `collections truncate <name_or_id> --yes` after confirming the collection should be emptied.",
    ):
        return
    if record_history:
        _record_command(ctx, f"collections truncate {name_or_id} --yes")
    _run_remote_action(
        ctx,
        action="collections.truncate",
        success_message="Collection truncate completed",
        operation=lambda client: client.collections_truncate(name_or_id),
    )


def _handle_collections_import(
    ctx: click.Context,
    *,
    data: str | None,
    file_path: str | None,
    stdin_json: bool = False,
    record_history: bool = True,
) -> None:
    if record_history:
        if file_path == "-":
            _record_command(ctx, "collections import --file -")
        elif stdin_json:
            _record_command(ctx, "collections import --stdin-json")
        else:
            _record_command(ctx, "collections import --data <json>" if data else "collections import --file <path>")

    try:
        body = _load_json_object_input(
            data=data,
            file_path=file_path,
            stdin_json=stdin_json,
            action="collections.import",
        )
        body = _parse_collections_import_payload(body)
    except ValueError as exc:
        emit_error(
            json_output=ctx.obj["json_output"],
            action="collections.import",
            message=str(exc),
        )
        return

    _run_remote_action(
        ctx,
        action="collections.import",
        success_message="Collections import completed",
        operation=lambda client: client.collections_import(body=body),
    )


def _handle_collections_scaffolds(ctx: click.Context, *, record_history: bool = True) -> None:
    if record_history:
        _record_command(ctx, "collections scaffolds")
    _run_remote_action(
        ctx,
        action="collections.scaffolds",
        success_message="Collection scaffolds fetch completed",
        operation=lambda client: client.collections_scaffolds(),
    )


def _handle_settings_get(ctx: click.Context, *, record_history: bool = True) -> None:
    if record_history:
        _record_command(ctx, "settings get")
    _run_remote_action(
        ctx,
        action="settings.get",
        success_message="Settings fetch completed",
        operation=lambda client: client.settings_get(),
    )


def _handle_settings_patch(
    ctx: click.Context,
    *,
    data: str | None,
    file_path: str | None,
    stdin_json: bool = False,
    record_history: bool = True,
) -> None:
    if record_history:
        if file_path == "-":
            _record_command(ctx, "settings patch --file -")
        elif stdin_json:
            _record_command(ctx, "settings patch --stdin-json")
        else:
            _record_command(ctx, "settings patch --data <json>" if data else "settings patch --file <path>")

    try:
        body = _load_json_object_input(
            data=data,
            file_path=file_path,
            stdin_json=stdin_json,
            action="settings.patch",
        )
    except ValueError as exc:
        emit_error(
            json_output=ctx.obj["json_output"],
            action="settings.patch",
            message=str(exc),
        )
        return

    _run_remote_action(
        ctx,
        action="settings.patch",
        success_message="Settings patch completed",
        operation=lambda client: client.settings_patch(body=body),
    )


def _handle_settings_test_s3(
    ctx: click.Context,
    *,
    data: str | None,
    file_path: str | None,
    stdin_json: bool = False,
    record_history: bool = True,
) -> None:
    if record_history:
        if file_path == "-":
            _record_command(ctx, "settings test-s3 --file -")
        elif stdin_json:
            _record_command(ctx, "settings test-s3 --stdin-json")
        else:
            _record_command(ctx, "settings test-s3 --data <json>" if data else "settings test-s3 --file <path>")

    try:
        body = _load_json_object_input(
            data=data,
            file_path=file_path,
            stdin_json=stdin_json,
            action="settings.test-s3",
        )
        body = _parse_settings_s3_test_payload(body)
    except ValueError as exc:
        emit_error(
            json_output=ctx.obj["json_output"],
            action="settings.test-s3",
            message=str(exc),
        )
        return

    _run_remote_action(
        ctx,
        action="settings.test-s3",
        success_message="Settings S3 test completed",
        operation=lambda client: client.settings_test_s3(body=body),
    )


def _handle_settings_test_email(
    ctx: click.Context,
    *,
    data: str | None,
    file_path: str | None,
    stdin_json: bool = False,
    record_history: bool = True,
) -> None:
    if record_history:
        if file_path == "-":
            _record_command(ctx, "settings test-email --file -")
        elif stdin_json:
            _record_command(ctx, "settings test-email --stdin-json")
        else:
            _record_command(ctx, "settings test-email --data <json>" if data else "settings test-email --file <path>")

    try:
        body = _load_json_object_input(
            data=data,
            file_path=file_path,
            stdin_json=stdin_json,
            action="settings.test-email",
        )
        body = _parse_settings_email_test_payload(body)
    except ValueError as exc:
        emit_error(
            json_output=ctx.obj["json_output"],
            action="settings.test-email",
            message=str(exc),
        )
        return

    _run_remote_action(
        ctx,
        action="settings.test-email",
        success_message="Settings email test completed",
        operation=lambda client: client.settings_test_email(body=body),
    )


def _handle_settings_generate_apple_client_secret(
    ctx: click.Context,
    *,
    data: str | None,
    file_path: str | None,
    stdin_json: bool = False,
    record_history: bool = True,
) -> None:
    if record_history:
        if file_path == "-":
            _record_command(ctx, "settings apple-client-secret --file -")
        elif stdin_json:
            _record_command(ctx, "settings apple-client-secret --stdin-json")
        else:
            _record_command(
                ctx,
                "settings apple-client-secret --data <json>" if data else "settings apple-client-secret --file <path>",
            )

    try:
        body = _load_json_object_input(
            data=data,
            file_path=file_path,
            stdin_json=stdin_json,
            action="settings.apple-client-secret",
        )
        body = _parse_apple_secret_payload(body)
    except ValueError as exc:
        emit_error(
            json_output=ctx.obj["json_output"],
            action="settings.apple-client-secret",
            message=str(exc),
        )
        return

    _run_remote_action(
        ctx,
        action="settings.apple-client-secret",
        success_message="Apple client secret generated",
        operation=lambda client: client.settings_generate_apple_client_secret(body=body),
    )


def _handle_logs_list(
    ctx: click.Context,
    *,
    page: int | None,
    per_page: int | None,
    filter_value: str | None,
    sort: str | None,
    all_pages: bool = False,
    record_history: bool = True,
) -> None:
    if record_history:
        _record_command(ctx, "logs list")
    action = "logs.list"
    operation: RemoteOperation
    if all_pages:
        operation = lambda client: _fetch_all_pages(
            action=action,
            per_page=per_page,
            fetch_page=lambda current_page, current_per_page: client.logs_list(
                page=current_page,
                per_page=current_per_page,
                filter_value=filter_value,
                sort=sort,
            ),
        )
    else:
        operation = lambda client: client.logs_list(
            page=page,
            per_page=per_page,
            filter_value=filter_value,
            sort=sort,
        )
    _run_remote_action(
        ctx,
        action=action,
        success_message="Logs list completed",
        operation=operation,
    )


def _handle_logs_get(
    ctx: click.Context,
    *,
    log_id: str,
    record_history: bool = True,
) -> None:
    if record_history:
        _record_command(ctx, f"logs get {log_id}")
    _run_remote_action(
        ctx,
        action="logs.get",
        success_message="Log fetch completed",
        operation=lambda client: client.logs_get(log_id),
    )


def _handle_logs_stats(
    ctx: click.Context,
    *,
    filter_value: str | None,
    record_history: bool = True,
) -> None:
    if record_history:
        _record_command(ctx, "logs stats")
    _run_remote_action(
        ctx,
        action="logs.stats",
        success_message="Logs stats completed",
        operation=lambda client: client.logs_stats(filter_value=filter_value),
    )


def _handle_crons_list(ctx: click.Context, *, record_history: bool = True) -> None:
    if record_history:
        _record_command(ctx, "crons list")
    _run_remote_action(
        ctx,
        action="crons.list",
        success_message="Crons list completed",
        operation=lambda client: client.crons_list(),
    )


def _handle_crons_run(
    ctx: click.Context,
    *,
    job_id: str,
    yes: bool,
    record_history: bool = True,
) -> None:
    if not _require_confirmation(
        ctx,
        action="crons.run",
        yes=yes,
        message="Cron run can trigger side effects immediately. Re-run with `--yes` to continue.",
        hint="Re-run `crons run <job_id> --yes` after confirming the job should execute now.",
    ):
        return
    if record_history:
        _record_command(ctx, f"crons run {job_id} --yes")
    _run_remote_action(
        ctx,
        action="crons.run",
        success_message="Cron run completed",
        operation=lambda client: client.crons_run(job_id),
    )


def _handle_records_auth_methods(
    ctx: click.Context,
    *,
    collection: str,
    record_history: bool = True,
) -> None:
    if record_history:
        _record_command(ctx, f"records auth-methods {collection}")
    _run_remote_action(
        ctx,
        action="records.auth-methods",
        success_message="Record auth methods fetch completed",
        operation=lambda client: client.record_auth_methods(collection=collection),
        require_auth=False,
    )


def _handle_records_auth_password(
    ctx: click.Context,
    *,
    collection: str,
    identity: str,
    password: str,
    identity_field: str | None,
    fields: str | None,
    expand: str | None,
    mfa_id: str | None,
    save_auth: bool,
    record_history: bool = True,
) -> None:
    resolved_base_url = _require_base_url(ctx, action="records.auth-password")

    if record_history:
        history_parts = ["records", "auth-password", collection]
        if identity_field:
            history_parts.extend(["--identity-field", identity_field])
        if fields:
            history_parts.extend(["--fields", fields])
        if expand:
            history_parts.extend(["--expand", expand])
        if mfa_id:
            history_parts.extend(["--mfa-id", mfa_id])
        if not save_auth:
            history_parts.append("--no-save")
        history_parts.extend([identity, password])
        _record_command(ctx, _redact_command(history_parts, {len(history_parts) - 1}))

    invocation = _call_remote(
        ctx,
        action="records.auth-password",
        operation=lambda client: client.record_auth_password(
            collection=collection,
            identity=identity,
            password=password,
            identity_field=identity_field,
            fields=fields,
            expand=expand,
            mfa_id=mfa_id,
        ),
        require_auth=False,
    )
    if invocation is None:
        return
    _, result = invocation

    _render_auth_or_mfa_result(
        ctx,
        action="records.auth-password",
        result=result,
        success_message="Record password auth completed",
        mfa_message="Record password auth requires MFA confirmation",
        base_url=resolved_base_url,
        collection=collection,
        save_auth=save_auth,
    )


def _handle_records_auth_oauth2(
    ctx: click.Context,
    *,
    collection: str,
    provider: str,
    code: str,
    redirect_url: str,
    code_verifier: str | None,
    create_data: str | None,
    create_file: str | None,
    create_stdin_json: bool = False,
    fields: str | None,
    expand: str | None,
    save_auth: bool,
    record_history: bool = True,
) -> None:
    resolved_base_url = _require_base_url(ctx, action="records.auth-oauth2")

    if record_history:
        history_parts = [
            "records",
            "auth-oauth2",
            collection,
            "--provider",
            provider,
            "--code",
            "********",
            "--redirect-url",
            redirect_url,
        ]
        if code_verifier:
            history_parts.extend(["--code-verifier", "********"])
        if create_data:
            history_parts.extend(["--create-data", "<json>"])
        if create_file:
            history_parts.extend(["--create-file", create_file])
        if create_stdin_json:
            history_parts.append("--create-stdin-json")
        if fields:
            history_parts.extend(["--fields", fields])
        if expand:
            history_parts.extend(["--expand", expand])
        if not save_auth:
            history_parts.append("--no-save")
        _record_command(ctx, " ".join(history_parts))

    try:
        create_payload = _load_optional_json_object_input(
            data=create_data,
            file_path=create_file,
            stdin_json=create_stdin_json,
            action="records.auth-oauth2",
        )
    except ValueError as exc:
        emit_error(
            json_output=ctx.obj["json_output"],
            action="records.auth-oauth2",
            message=str(exc),
        )
        return

    invocation = _call_remote(
        ctx,
        action="records.auth-oauth2",
        operation=lambda client: client.record_auth_oauth2(
            collection=collection,
            provider=provider,
            code=code,
            redirect_url=redirect_url,
            code_verifier=code_verifier,
            create_data=create_payload,
            fields=fields,
            expand=expand,
        ),
        require_auth=False,
    )
    if invocation is None:
        return
    _, result = invocation

    _render_auth_or_mfa_result(
        ctx,
        action="records.auth-oauth2",
        result=result,
        success_message="Record OAuth2 auth completed",
        mfa_message="Record OAuth2 auth requires MFA confirmation",
        base_url=resolved_base_url,
        collection=collection,
        save_auth=save_auth,
    )


def _handle_records_auth_refresh(
    ctx: click.Context,
    *,
    collection: str,
    fields: str | None,
    expand: str | None,
    save_auth: bool,
    record_history: bool = True,
) -> None:
    if record_history:
        history_parts = ["records", "auth-refresh", collection]
        if fields:
            history_parts.extend(["--fields", fields])
        if expand:
            history_parts.extend(["--expand", expand])
        if not save_auth:
            history_parts.append("--no-save")
        _record_command(ctx, " ".join(history_parts))

    client = _build_remote_client(ctx, require_auth=True)
    try:
        result = client.record_auth_refresh(
            collection=collection,
            fields=fields,
            expand=expand,
        )
    except PocketBaseRemoteError as exc:
        _handle_remote_error(ctx, action="records.auth-refresh", error=exc)
        return

    _render_auth_or_mfa_result(
        ctx,
        action="records.auth-refresh",
        result=result,
        success_message="Record auth refresh completed",
        mfa_message="Record auth refresh requires MFA confirmation",
        base_url=client.base_url,
        collection=collection,
        save_auth=save_auth,
    )


def _handle_records_request_otp(
    ctx: click.Context,
    *,
    collection: str,
    email: str,
    record_history: bool = True,
) -> None:
    if record_history:
        _record_command(ctx, f"records request-otp {collection} {email}")
    _run_remote_action(
        ctx,
        action="records.request-otp",
        success_message="Record OTP request completed",
        operation=lambda client: client.record_request_otp(collection=collection, email=email),
        require_auth=False,
    )


def _handle_records_auth_otp(
    ctx: click.Context,
    *,
    collection: str,
    otp_id: str,
    password: str,
    fields: str | None,
    expand: str | None,
    mfa_id: str | None,
    save_auth: bool,
    record_history: bool = True,
) -> None:
    resolved_base_url = _require_base_url(ctx, action="records.auth-otp")

    if record_history:
        history_parts = ["records", "auth-otp", collection]
        if fields:
            history_parts.extend(["--fields", fields])
        if expand:
            history_parts.extend(["--expand", expand])
        if mfa_id:
            history_parts.extend(["--mfa-id", mfa_id])
        if not save_auth:
            history_parts.append("--no-save")
        history_parts.extend([otp_id, password])
        _record_command(ctx, _redact_command(history_parts, {len(history_parts) - 1}))

    invocation = _call_remote(
        ctx,
        action="records.auth-otp",
        operation=lambda client: client.record_auth_otp(
            collection=collection,
            otp_id=otp_id,
            password=password,
            fields=fields,
            expand=expand,
            mfa_id=mfa_id,
        ),
        require_auth=False,
    )
    if invocation is None:
        return
    _, result = invocation

    _render_auth_or_mfa_result(
        ctx,
        action="records.auth-otp",
        result=result,
        success_message="Record OTP auth completed",
        mfa_message="Record OTP auth requires MFA confirmation",
        base_url=resolved_base_url,
        collection=collection,
        save_auth=save_auth,
    )


def _handle_records_request_password_reset(
    ctx: click.Context,
    *,
    collection: str,
    email: str,
    record_history: bool = True,
) -> None:
    if record_history:
        _record_command(ctx, f"records request-password-reset {collection} {email}")
    _run_remote_action(
        ctx,
        action="records.request-password-reset",
        success_message="Record password reset request completed",
        operation=lambda client: client.record_request_password_reset(collection=collection, email=email),
        require_auth=False,
    )


def _handle_records_confirm_password_reset(
    ctx: click.Context,
    *,
    collection: str,
    token: str,
    password: str,
    password_confirm: str,
    record_history: bool = True,
) -> None:
    if record_history:
        history_parts = [
            "records",
            "confirm-password-reset",
            collection,
            token,
            password,
            password_confirm,
        ]
        _record_command(ctx, _redact_command(history_parts, {3, 4, 5}))

    _run_remote_action(
        ctx,
        action="records.confirm-password-reset",
        success_message="Record password reset confirmation completed",
        operation=lambda client: client.record_confirm_password_reset(
            collection=collection,
            token=token,
            password=password,
            password_confirm=password_confirm,
        ),
        require_auth=False,
    )


def _handle_records_request_verification(
    ctx: click.Context,
    *,
    collection: str,
    email: str,
    record_history: bool = True,
) -> None:
    if record_history:
        _record_command(ctx, f"records request-verification {collection} {email}")
    _run_remote_action(
        ctx,
        action="records.request-verification",
        success_message="Record verification request completed",
        operation=lambda client: client.record_request_verification(collection=collection, email=email),
        require_auth=False,
    )


def _handle_records_confirm_verification(
    ctx: click.Context,
    *,
    collection: str,
    token: str,
    record_history: bool = True,
) -> None:
    if record_history:
        _record_command(ctx, _redact_command(["records", "confirm-verification", collection, token], {3}))

    _run_remote_action(
        ctx,
        action="records.confirm-verification",
        success_message="Record verification confirmation completed",
        operation=lambda client: client.record_confirm_verification(collection=collection, token=token),
        require_auth=False,
    )


def _handle_records_request_email_change(
    ctx: click.Context,
    *,
    collection: str,
    new_email: str,
    record_history: bool = True,
) -> None:
    if record_history:
        _record_command(ctx, f"records request-email-change {collection} {new_email}")
    _run_remote_action(
        ctx,
        action="records.request-email-change",
        success_message="Record email change request completed",
        operation=lambda client: client.record_request_email_change(collection=collection, new_email=new_email),
    )


def _handle_records_confirm_email_change(
    ctx: click.Context,
    *,
    collection: str,
    token: str,
    password: str,
    record_history: bool = True,
) -> None:
    if record_history:
        _record_command(
            ctx,
            _redact_command(["records", "confirm-email-change", collection, token, password], {3, 4}),
        )

    _run_remote_action(
        ctx,
        action="records.confirm-email-change",
        success_message="Record email change confirmation completed",
        operation=lambda client: client.record_confirm_email_change(
            collection=collection,
            token=token,
            password=password,
        ),
        require_auth=False,
    )


def _handle_records_impersonate(
    ctx: click.Context,
    *,
    collection: str,
    record_id: str,
    duration: int | None,
    fields: str | None,
    expand: str | None,
    save_auth: bool,
    record_history: bool = True,
) -> None:
    if record_history:
        history_parts = ["records", "impersonate", collection, record_id]
        if duration is not None:
            history_parts.extend(["--duration", str(duration)])
        if fields:
            history_parts.extend(["--fields", fields])
        if expand:
            history_parts.extend(["--expand", expand])
        if not save_auth:
            history_parts.append("--no-save")
        _record_command(ctx, " ".join(history_parts))

    client = _build_remote_client(ctx, require_auth=True)
    try:
        result = client.record_impersonate(
            collection=collection,
            record_id=record_id,
            duration=duration,
            fields=fields,
            expand=expand,
        )
    except PocketBaseRemoteError as exc:
        _handle_remote_error(ctx, action="records.impersonate", error=exc)
        return

    _render_auth_or_mfa_result(
        ctx,
        action="records.impersonate",
        result=result,
        success_message="Record impersonation completed",
        mfa_message="Record impersonation requires MFA confirmation",
        base_url=client.base_url,
        collection=collection,
        save_auth=save_auth,
    )


def _handle_records_list(
    ctx: click.Context,
    *,
    collection: str,
    page: int | None,
    per_page: int | None,
    filter_value: str | None,
    sort: str | None,
    fields: str | None,
    expand: str | None,
    all_pages: bool = False,
    record_history: bool = True,
) -> None:
    if record_history:
        _record_command(ctx, f"records list {collection}")
    action = "records.list"
    operation: RemoteOperation
    if all_pages:
        operation = lambda client: _fetch_all_pages(
            action=action,
            per_page=per_page,
            fetch_page=lambda current_page, current_per_page: client.records_list(
                collection=collection,
                page=current_page,
                per_page=current_per_page,
                filter_value=filter_value,
                sort=sort,
                fields=fields,
                expand=expand,
            ),
        )
    else:
        operation = lambda client: client.records_list(
            collection=collection,
            page=page,
            per_page=per_page,
            filter_value=filter_value,
            sort=sort,
            fields=fields,
            expand=expand,
        )
    _run_remote_action(
        ctx,
        action=action,
        success_message="Records list completed",
        operation=operation,
    )


def _handle_records_get(
    ctx: click.Context,
    *,
    collection: str,
    record_id: str,
    fields: str | None,
    expand: str | None,
    record_history: bool = True,
) -> None:
    if record_history:
        _record_command(ctx, f"records get {collection} {record_id}")
    _run_remote_action(
        ctx,
        action="records.get",
        success_message="Record fetch completed",
        operation=lambda client: client.records_get(
            collection=collection,
            record_id=record_id,
            fields=fields,
            expand=expand,
        ),
    )


def _handle_records_create(
    ctx: click.Context,
    *,
    collection: str,
    data: str | None,
    file_path: str | None,
    stdin_json: bool = False,
    record_history: bool = True,
) -> None:
    if record_history:
        if file_path == "-":
            _record_command(ctx, f"records create {collection} --file -")
        elif stdin_json:
            _record_command(ctx, f"records create {collection} --stdin-json")
        else:
            _record_command(ctx, f"records create {collection} --data <json>" if data else f"records create {collection} --file <path>")

    try:
        body = _load_json_object_input(
            data=data,
            file_path=file_path,
            stdin_json=stdin_json,
            action="records.create",
        )
    except ValueError as exc:
        emit_error(
            json_output=ctx.obj["json_output"],
            action="records.create",
            message=str(exc),
        )
        return

    _run_remote_action(
        ctx,
        action="records.create",
        success_message="Record create completed",
        operation=lambda client: client.records_create(collection=collection, body=body),
    )


def _handle_records_update(
    ctx: click.Context,
    *,
    collection: str,
    record_id: str,
    data: str | None,
    file_path: str | None,
    stdin_json: bool = False,
    record_history: bool = True,
) -> None:
    if record_history:
        if file_path == "-":
            _record_command(ctx, f"records update {collection} {record_id} --file -")
        elif stdin_json:
            _record_command(ctx, f"records update {collection} {record_id} --stdin-json")
        else:
            _record_command(
                ctx,
                f"records update {collection} {record_id} --data <json>"
                if data
                else f"records update {collection} {record_id} --file <path>",
            )

    try:
        body = _load_json_object_input(
            data=data,
            file_path=file_path,
            stdin_json=stdin_json,
            action="records.update",
        )
    except ValueError as exc:
        emit_error(
            json_output=ctx.obj["json_output"],
            action="records.update",
            message=str(exc),
        )
        return

    _run_remote_action(
        ctx,
        action="records.update",
        success_message="Record update completed",
        operation=lambda client: client.records_update(collection=collection, record_id=record_id, body=body),
    )


def _handle_records_delete(
    ctx: click.Context,
    *,
    collection: str,
    record_id: str,
    yes: bool,
    record_history: bool = True,
) -> None:
    if not _require_confirmation(
        ctx,
        action="records.delete",
        yes=yes,
        message="Record delete is destructive. Re-run with `--yes` to continue.",
        hint="Re-run `records delete <collection> <record_id> --yes` after confirming the record id.",
    ):
        return
    if record_history:
        _record_command(ctx, f"records delete {collection} {record_id} --yes")
    _run_remote_action(
        ctx,
        action="records.delete",
        success_message="Record delete completed",
        operation=lambda client: client.records_delete(collection=collection, record_id=record_id),
    )


def _handle_records_find(
    ctx: click.Context,
    *,
    collection: str,
    filter_value: str,
    first: bool,
    per_page: int | None,
    sort: str | None,
    fields: str | None,
    expand: str | None,
    record_history: bool = True,
) -> None:
    if record_history:
        history_parts = ["records", "find", collection, "--filter", filter_value]
        if first:
            history_parts.append("--first")
        if per_page is not None:
            history_parts.extend(["--per-page", str(per_page)])
        if sort:
            history_parts.extend(["--sort", sort])
        if fields:
            history_parts.extend(["--fields", fields])
        if expand:
            history_parts.extend(["--expand", expand])
        _record_command(ctx, " ".join(history_parts))

    client = _build_remote_client(ctx, require_auth=True)
    try:
        if first:
            result = client.records_list(
                collection=collection,
                page=1,
                per_page=1,
                filter_value=filter_value,
                sort=sort,
                fields=fields,
                expand=expand,
            )
        else:
            result = _fetch_all_pages(
                action="records.find",
                per_page=per_page,
                fetch_page=lambda current_page, current_per_page: client.records_list(
                    collection=collection,
                    page=current_page,
                    per_page=current_per_page,
                    filter_value=filter_value,
                    sort=sort,
                    fields=fields,
                    expand=expand,
                ),
            )
    except PocketBaseRemoteError as exc:
        _handle_remote_error(ctx, action="records.find", error=exc)
        return

    payload = _extract_paginated_payload(result, action="records.find")
    items = payload.get("items") or []
    emit_success(
        json_output=ctx.obj["json_output"],
        action="records.find",
        message="Record filter query completed",
        data={
            "collection": collection,
            "filter": filter_value,
            "matched_count": payload.get("totalItems", len(items)),
            "found": bool(items),
            "record": items[0] if items else None,
            "items": items,
            "page_info": payload,
        },
    )


def _handle_records_upsert(
    ctx: click.Context,
    *,
    collection: str,
    filter_value: str,
    data: str | None,
    file_path: str | None,
    stdin_json: bool,
    first: bool,
    fields: str | None,
    expand: str | None,
    record_history: bool = True,
) -> None:
    if record_history:
        history_parts = ["records", "upsert", collection, "--filter", filter_value]
        if file_path == "-":
            history_parts.extend(["--file", "-"])
        elif stdin_json:
            history_parts.append("--stdin-json")
        elif file_path:
            history_parts.extend(["--file", file_path])
        else:
            history_parts.extend(["--data", "<json>"])
        if first:
            history_parts.append("--first")
        if fields:
            history_parts.extend(["--fields", fields])
        if expand:
            history_parts.extend(["--expand", expand])
        _record_command(ctx, " ".join(history_parts))

    try:
        body = _load_json_object_input(
            data=data,
            file_path=file_path,
            stdin_json=stdin_json,
            action="records.upsert",
        )
    except ValueError as exc:
        emit_error(
            json_output=ctx.obj["json_output"],
            action="records.upsert",
            message=str(exc),
        )
        return

    client = _build_remote_client(ctx, require_auth=True)
    try:
        lookup = client.records_list(
            collection=collection,
            page=1,
            per_page=2 if first else 2,
            filter_value=filter_value,
            sort=None,
            fields=fields,
            expand=expand,
        )
        lookup_payload = _extract_paginated_payload(lookup, action="records.upsert")
        matched_items = lookup_payload.get("items") or []
        matched_count = lookup_payload.get("totalItems", len(matched_items))

        if matched_count == 0:
            result = client.records_create(collection=collection, body=body)
            operation = "create"
        else:
            if matched_count != 1 and not first:
                emit_error(
                    json_output=ctx.obj["json_output"],
                    action="records.upsert",
                    message=f"Filter matched {matched_count} records. Narrow the filter or pass `--first` to update the first match.",
                    error_type="invalid_input",
                    hint="Use `records find <collection> --filter ...` to inspect matches before upsert.",
                    data={
                        "collection": collection,
                        "filter": filter_value,
                        "matched_count": matched_count,
                    },
                )
                return

            target = matched_items[0]
            target_id = target.get("id")
            if not isinstance(target_id, str) or not target_id:
                emit_error(
                    json_output=ctx.obj["json_output"],
                    action="records.upsert",
                    message="Matched record did not include a usable `id`.",
                )
                return
            result = client.records_update(collection=collection, record_id=target_id, body=body)
            operation = "update"
    except PocketBaseRemoteError as exc:
        _handle_remote_error(ctx, action="records.upsert", error=exc)
        return
    except ValueError as exc:
        emit_error(
            json_output=ctx.obj["json_output"],
            action="records.upsert",
            message=str(exc),
        )
        return

    emit_success(
        json_output=ctx.obj["json_output"],
        action="records.upsert",
        message="Record upsert completed",
        data={
            "collection": collection,
            "filter": filter_value,
            "matched_count": matched_count,
            "operation": operation,
            "data": result.data,
            "method": result.method,
            "url": result.url,
            "status": result.status,
        },
    )


def _handle_records_delete_by_filter(
    ctx: click.Context,
    *,
    collection: str,
    filter_value: str,
    yes: bool,
    expect_count: int | None,
    record_history: bool = True,
) -> None:
    if not _require_confirmation(
        ctx,
        action="records.delete-by-filter",
        yes=yes,
        message="Filtered record deletion is destructive. Re-run with `--yes` to continue.",
        hint="Re-run `records delete-by-filter <collection> --filter ... --yes` after verifying the matched set.",
    ):
        return

    if record_history:
        history_parts = ["records", "delete-by-filter", collection, "--filter", filter_value, "--yes"]
        if expect_count is not None:
            history_parts.extend(["--expect-count", str(expect_count)])
        _record_command(ctx, " ".join(history_parts))

    client = _build_remote_client(ctx, require_auth=True)
    try:
        lookup = _fetch_all_pages(
            action="records.delete-by-filter",
            per_page=None,
            fetch_page=lambda current_page, current_per_page: client.records_list(
                collection=collection,
                page=current_page,
                per_page=current_per_page,
                filter_value=filter_value,
                sort=None,
                fields="id",
                expand=None,
            ),
        )
        lookup_payload = _extract_paginated_payload(lookup, action="records.delete-by-filter")
        items = lookup_payload.get("items") or []
    except PocketBaseRemoteError as exc:
        _handle_remote_error(ctx, action="records.delete-by-filter", error=exc)
        return

    matched_count = len(items)
    if expect_count is not None and matched_count != expect_count:
        emit_error(
            json_output=ctx.obj["json_output"],
            action="records.delete-by-filter",
            message=f"Expected {expect_count} records but matched {matched_count}.",
            error_type="invalid_input",
            hint="Use `records find <collection> --filter ...` to inspect the matched records first.",
            data={
                "collection": collection,
                "filter": filter_value,
                "matched_count": matched_count,
                "expected_count": expect_count,
            },
        )
        return

    deleted_ids: list[str] = []
    for item in items:
        record_id = item.get("id")
        if not isinstance(record_id, str) or not record_id:
            continue
        try:
            client.records_delete(collection=collection, record_id=record_id)
        except PocketBaseRemoteError as exc:
            _handle_remote_error(ctx, action="records.delete-by-filter", error=exc)
            return
        deleted_ids.append(record_id)

    emit_success(
        json_output=ctx.obj["json_output"],
        action="records.delete-by-filter",
        message="Filtered record delete completed",
        data={
            "collection": collection,
            "filter": filter_value,
            "matched_count": matched_count,
            "deleted_count": len(deleted_ids),
            "deleted_ids": deleted_ids,
        },
    )


def _handle_files_token(ctx: click.Context, *, record_history: bool = True) -> None:
    if record_history:
        _record_command(ctx, "files token")
    _run_remote_action(
        ctx,
        action="files.token",
        success_message="File token generated",
        operation=lambda client: client.files_token(),
    )


def _handle_backups_list(ctx: click.Context, *, record_history: bool = True) -> None:
    if record_history:
        _record_command(ctx, "backups list")
    _run_remote_action(
        ctx,
        action="backups.list",
        success_message="Backups list completed",
        operation=lambda client: client.backups_list(),
    )


def _handle_backups_create(
    ctx: click.Context,
    *,
    name: str | None,
    record_history: bool = True,
) -> None:
    if record_history:
        parts = ["backups", "create"]
        if name:
            parts.extend(["--name", name])
        _record_command(ctx, " ".join(parts))

    _run_remote_action(
        ctx,
        action="backups.create",
        success_message="Backup create completed",
        operation=lambda client: client.backups_create(name=name),
    )


def _handle_backups_upload(
    ctx: click.Context,
    *,
    file_path: str,
    record_history: bool = True,
) -> None:
    if record_history:
        _record_command(ctx, f"backups upload {file_path}")

    source_path = Path(file_path)
    if not source_path.exists():
        emit_error(
            json_output=ctx.obj["json_output"],
            action="backups.upload",
            message=f"Backup file does not exist: {source_path}",
        )
        return
    if not source_path.is_file():
        emit_error(
            json_output=ctx.obj["json_output"],
            action="backups.upload",
            message=f"Backup upload path is not a file: {source_path}",
        )
        return

    client = _build_remote_client(ctx, require_auth=True)
    try:
        result = client.backups_upload(file_path=source_path)
    except PocketBaseRemoteError as exc:
        _handle_remote_error(ctx, action="backups.upload", error=exc)
        return
    except OSError as exc:
        emit_error(
            json_output=ctx.obj["json_output"],
            action="backups.upload",
            message=f"Failed to read backup file: {exc}",
        )
        return

    emit_success(
        json_output=ctx.obj["json_output"],
        action="backups.upload",
        message="Backup upload completed",
        data={
            "url": result.url,
            "status": result.status,
            "path": str(source_path),
            "name": source_path.name,
            "size": source_path.stat().st_size,
        },
    )


def _handle_backups_delete(
    ctx: click.Context,
    *,
    name: str,
    yes: bool,
    record_history: bool = True,
) -> None:
    if not _require_confirmation(
        ctx,
        action="backups.delete",
        yes=yes,
        message="Backup delete is destructive. Re-run with `--yes` to continue.",
        hint="Re-run `backups delete <name> --yes` after confirming the archive should be removed.",
    ):
        return
    if record_history:
        _record_command(ctx, f"backups delete {name} --yes")

    _run_remote_action(
        ctx,
        action="backups.delete",
        success_message="Backup delete completed",
        operation=lambda client: client.backups_delete(name),
    )


def _handle_backups_download(
    ctx: click.Context,
    *,
    name: str,
    output: str | None,
    token: str | None,
    overwrite: bool,
    record_history: bool = True,
) -> None:
    history_parts = ["backups", "download", name]
    if output:
        history_parts.extend(["--output", output])
    if overwrite:
        history_parts.append("--overwrite")
    sensitive_indexes: set[int] = set()
    if token:
        history_parts.extend(["--token", token])
        sensitive_indexes.add(len(history_parts) - 1)
    if record_history:
        _record_command(ctx, _redact_command(history_parts, sensitive_indexes or None))

    target_path = Path(output) if output else Path.cwd() / Path(name).name
    if target_path.exists() and not overwrite:
        emit_error(
            json_output=ctx.obj["json_output"],
            action="backups.download",
            message=f"Output file already exists: {target_path}. Pass `--overwrite` to replace it.",
        )
        return

    client = _build_remote_client(ctx, require_auth=True)
    resolved_token = token or _resolve_file_token(ctx, action="backups.download", client=client)
    if resolved_token is None:
        return
    try:
        url, status, content = client.backups_download(name=name, token=resolved_token)
    except PocketBaseRemoteError as exc:
        _handle_remote_error(ctx, action="backups.download", error=exc)
        return

    try:
        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_bytes(content)
    except OSError as exc:
        emit_error(
            json_output=ctx.obj["json_output"],
            action="backups.download",
            message=f"Failed to write backup file: {exc}",
        )
        return

    emit_success(
        json_output=ctx.obj["json_output"],
        action="backups.download",
        message="Backup download completed",
        data={
            "url": url,
            "status": status,
            "path": str(target_path),
            "size": len(content),
            "name": name,
        },
    )


def _handle_backups_restore(
    ctx: click.Context,
    *,
    name: str,
    yes: bool,
    record_history: bool = True,
) -> None:
    if not _require_confirmation(
        ctx,
        action="backups.restore",
        yes=yes,
        message="Backup restore is destructive. Re-run with `--yes` to continue.",
        hint="Re-run `backups restore <name> --yes` after confirming the remote app can be restarted.",
    ):
        return

    if record_history:
        _record_command(ctx, f"backups restore {name} --yes")
    _run_remote_action(
        ctx,
        action="backups.restore",
        success_message="Backup restore started",
        operation=lambda client: client.backups_restore(name),
    )


def _handle_batch_run(
    ctx: click.Context,
    *,
    data: str | None,
    file_path: str | None,
    stdin_json: bool = False,
    record_history: bool = True,
) -> None:
    if record_history:
        if file_path == "-":
            _record_command(ctx, "batch run --file -")
        elif stdin_json:
            _record_command(ctx, "batch run --stdin-json")
        elif file_path:
            _record_command(ctx, f"batch run --file {file_path}")
        else:
            _record_command(ctx, "batch run --data <json>")

    try:
        payload = _load_json_object_input(
            data=data,
            file_path=file_path,
            stdin_json=stdin_json,
            action="batch.run",
        )
        payload = _parse_batch_payload(payload)
    except ValueError as exc:
        emit_error(
            json_output=ctx.obj["json_output"],
            action="batch.run",
            message=str(exc),
        )
        return

    _run_remote_action(
        ctx,
        action="batch.run",
        success_message="Batch run completed",
        operation=lambda client: client.batch_run(body=payload),
    )


def _handle_files_url(
    ctx: click.Context,
    *,
    collection: str,
    record_id: str,
    filename: str,
    thumb: str | None,
    download: bool,
    token: str | None,
    with_token: bool,
    record_history: bool = True,
) -> None:
    if token and with_token:
        emit_error(
            json_output=ctx.obj["json_output"],
            action="files.url",
            message="Use either `--token` or `--with-token`, not both.",
        )
        return

    history_parts = ["files", "url", collection, record_id, filename]
    if thumb:
        history_parts.extend(["--thumb", thumb])
    if download:
        history_parts.append("--download")

    sensitive_indexes: set[int] = set()
    if token:
        history_parts.extend(["--token", token])
        sensitive_indexes.add(len(history_parts) - 1)
    if with_token:
        history_parts.append("--with-token")

    if record_history:
        _record_command(ctx, _redact_command(history_parts, sensitive_indexes or None))

    client = _build_remote_client(ctx, require_auth=with_token)

    resolved_token = token
    if with_token:
        resolved_token = _resolve_file_token(ctx, action="files.url", client=client)
        if resolved_token is None:
            return

    payload = {
        "url": client.build_file_url(
            collection=collection,
            record_id=record_id,
            filename=filename,
            thumb=thumb,
            download=download,
            token=resolved_token,
        ),
        "collection": collection,
        "record_id": record_id,
        "filename": filename,
        "thumb": thumb,
        "download": download,
        "token": resolved_token,
    }

    emit_success(
        json_output=ctx.obj["json_output"],
        action="files.url",
        message="File URL generated",
        data=payload,
    )


def _handle_raw(
    ctx: click.Context,
    *,
    method: str,
    path: str,
    data: str | None,
    file_path: str | None = None,
    stdin_json: bool = False,
    record_history: bool = True,
) -> None:
    if record_history:
        if file_path == "-":
            _record_command(ctx, f"raw {method.upper()} {path} --file -")
        elif stdin_json:
            _record_command(ctx, f"raw {method.upper()} {path} --stdin-json")
        else:
            _record_command(ctx, f"raw {method.upper()} {path}")

    body = None
    if data is not None or file_path is not None or stdin_json:
        try:
            body = _load_optional_json_object_input(
                data=data,
                file_path=file_path,
                stdin_json=stdin_json,
                action="raw",
            )
        except ValueError as exc:
            emit_error(
                json_output=ctx.obj["json_output"],
                action="raw",
                message=str(exc),
            )
            return

    _run_remote_action(
        ctx,
        action="raw",
        success_message="Raw request completed",
        operation=lambda client: client.raw(method=method, path=path, body=body, require_auth=False),
        require_auth=False,
    )


@click.group(invoke_without_command=True)
@click.option("--json", "json_output", is_flag=True, help="Emit machine-readable JSON output")
@click.pass_context
def cli(ctx: click.Context, json_output: bool) -> None:
    """Remote-only CLI-Anything harness for PocketBase."""
    ctx.obj = _build_context(json_output=json_output)

    if ctx.invoked_subcommand is None:
        repl = PocketBaseRepl(
            state=ctx.obj["state"],
            dispatch=lambda tokens: _dispatch_repl(ctx, tokens),
            save_state=lambda: _save_state(ctx),
            json_output=ctx.obj["json_output"],
        )
        repl.run()


@cli.command("repl")
@click.pass_context
def repl_command(ctx: click.Context) -> None:
    """Start interactive REPL mode explicitly."""
    repl = PocketBaseRepl(
        state=ctx.obj["state"],
        dispatch=lambda tokens: _dispatch_repl(ctx, tokens),
        save_state=lambda: _save_state(ctx),
        json_output=ctx.obj["json_output"],
    )
    repl.run()


@cli.command("info")
@click.pass_context
def info_command(ctx: click.Context) -> None:
    """Show remote mode details, config, auth state, and health check."""
    _handle_info(ctx)


@cli.command("schema")
@click.argument("command_path", nargs=-1)
@click.option("--json", "force_json", is_flag=True, help="Emit schema payload as JSON for tool/LLM usage")
@click.option("--include-hidden", is_flag=True, help="Include hidden compatibility commands in schema output")
@click.pass_context
def schema_command(
    ctx: click.Context,
    command_path: tuple[str, ...],
    force_json: bool,
    include_hidden: bool,
) -> None:
    """Show machine-readable command schema for tools and LLM agents."""
    if force_json:
        ctx.obj["json_output"] = True

    contract = _schema_contract(include_hidden=include_hidden)
    if not command_path:
        emit_success(
            json_output=ctx.obj["json_output"],
            action="schema",
            message="Command schema contract",
            data=contract,
        )
        return

    query = _normalize_schema_path(" ".join(command_path))
    index: dict[str, dict[str, Any]] = {}
    for entry in contract["entries"]:
        path_value = str(entry["path"])
        normalized_path = "" if path_value == "root" else _normalize_schema_path(path_value)
        index[normalized_path] = entry
    if query == "root":
        query = ""
    entry = index.get(query)
    if entry is None:
        known_paths = sorted(path for path in index if path)
        suggestions = [
            index[path]["path"]
            for path in known_paths
            if path.startswith(query)
        ] if query else [index[path]["path"] for path in known_paths]
        emit_error(
            json_output=ctx.obj["json_output"],
            action="schema",
            message=f"Unknown command path: {' '.join(command_path)}",
            data={
                "requested_path": " ".join(command_path),
                "normalized_path": query,
                "suggestions": suggestions[:20],
            },
        )
        return

    emit_success(
        json_output=ctx.obj["json_output"],
        action="schema",
        message="Command schema",
        data=entry,
    )


@cli.command("raw")
@click.argument("method")
@click.argument("path")
@click.option("--data", default=None, help="JSON object body")
@click.option("--file", "file_path", default=None, help="Path to a JSON file or `-` to read the body from stdin")
@click.option("--stdin-json", is_flag=True, help="Read the JSON object body from stdin")
@click.pass_context
def raw_command(
    ctx: click.Context,
    method: str,
    path: str,
    data: str | None,
    file_path: str | None,
    stdin_json: bool,
) -> None:
    """Send a raw PocketBase HTTP request."""
    _handle_raw(ctx, method=method, path=path, data=data, file_path=file_path, stdin_json=stdin_json)


@cli.group("auth")
def auth_group() -> None:
    """Manage remote PocketBase auth session."""


@auth_group.command("login")
@click.option("--base-url", default=None, help="PocketBase base URL, for example https://pb.example.com")
@click.option("--collection", default=None, help="Auth collection to use, defaults to config auth_collection or _superusers")
@click.option("--password-stdin", is_flag=True, help="Read the password from stdin instead of argv")
@click.argument("identity")
@click.argument("password", required=False)
@click.pass_context
def auth_login_command(
    ctx: click.Context,
    base_url: str | None,
    collection: str | None,
    password_stdin: bool,
    identity: str,
    password: str | None,
) -> None:
    if password_stdin:
        if password is not None:
            emit_error(
                json_output=ctx.obj["json_output"],
                action="auth.login",
                message="Use either a positional password or `--password-stdin`, not both.",
                error_type="invalid_input",
            )
            return
        try:
            password = _read_secret_from_stdin(action="auth.login")
        except ValueError as exc:
            emit_error(
                json_output=ctx.obj["json_output"],
                action="auth.login",
                message=str(exc),
                error_type="invalid_input",
            )
            return
    elif password is None:
        emit_error(
            json_output=ctx.obj["json_output"],
            action="auth.login",
            message="auth login requires a password argument or `--password-stdin`.",
            error_type="invalid_input",
            hint="Use `auth login <identity> --password-stdin` for automation-safe input.",
        )
        return

    _handle_auth_login(
        ctx,
        base_url=base_url,
        identity=identity,
        password=password,
        collection=collection,
    )


@auth_group.command("logout")
@click.pass_context
def auth_logout_command(ctx: click.Context) -> None:
    _handle_auth_logout(ctx)


@auth_group.command("status")
@click.pass_context
def auth_status_command(ctx: click.Context) -> None:
    _handle_auth_status(ctx)


@auth_group.command("whoami")
@click.pass_context
def auth_whoami_command(ctx: click.Context) -> None:
    _handle_auth_whoami(ctx)


@auth_group.command("refresh")
@click.pass_context
def auth_refresh_command(ctx: click.Context) -> None:
    _handle_auth_refresh(ctx)


@cli.group("settings")
def settings_group() -> None:
    """Remote settings endpoints."""


@settings_group.command("get")
@click.pass_context
def settings_get_command(ctx: click.Context) -> None:
    _handle_settings_get(ctx)


@settings_group.command("patch")
@click.option("--data", default=None, help="JSON object body")
@click.option("--file", "file_path", default=None, help="Path to a JSON file or `-` to read from stdin")
@click.option("--stdin-json", is_flag=True, help="Read the JSON object body from stdin")
@click.pass_context
def settings_patch_command(ctx: click.Context, data: str | None, file_path: str | None, stdin_json: bool) -> None:
    _handle_settings_patch(ctx, data=data, file_path=file_path, stdin_json=stdin_json)


@settings_group.command("test-s3")
@click.option("--data", default=None, help="JSON object body")
@click.option("--file", "file_path", default=None, help="Path to a JSON file or `-` to read from stdin")
@click.option("--stdin-json", is_flag=True, help="Read the JSON object body from stdin")
@click.pass_context
def settings_test_s3_command(ctx: click.Context, data: str | None, file_path: str | None, stdin_json: bool) -> None:
    _handle_settings_test_s3(ctx, data=data, file_path=file_path, stdin_json=stdin_json)


@settings_group.command("test-email")
@click.option("--data", default=None, help="JSON object body")
@click.option("--file", "file_path", default=None, help="Path to a JSON file or `-` to read from stdin")
@click.option("--stdin-json", is_flag=True, help="Read the JSON object body from stdin")
@click.pass_context
def settings_test_email_command(ctx: click.Context, data: str | None, file_path: str | None, stdin_json: bool) -> None:
    _handle_settings_test_email(ctx, data=data, file_path=file_path, stdin_json=stdin_json)


@settings_group.command("apple-client-secret")
@click.option("--data", default=None, help="JSON object body")
@click.option("--file", "file_path", default=None, help="Path to a JSON file or `-` to read from stdin")
@click.option("--stdin-json", is_flag=True, help="Read the JSON object body from stdin")
@click.pass_context
def settings_apple_client_secret_command(ctx: click.Context, data: str | None, file_path: str | None, stdin_json: bool) -> None:
    _handle_settings_generate_apple_client_secret(ctx, data=data, file_path=file_path, stdin_json=stdin_json)


@cli.group("logs")
def logs_group() -> None:
    """Remote logs endpoints."""


@logs_group.command("list")
@click.option("--page", type=int, default=None)
@click.option("--per-page", type=int, default=None)
@click.option("--filter", "filter_value", default=None)
@click.option("--sort", default=None)
@click.option("--all", "all_pages", is_flag=True, help="Fetch all pages and merge them into a single result payload")
@click.pass_context
def logs_list_command(
    ctx: click.Context,
    page: int | None,
    per_page: int | None,
    filter_value: str | None,
    sort: str | None,
    all_pages: bool,
) -> None:
    _handle_logs_list(
        ctx,
        page=page,
        per_page=per_page,
        filter_value=filter_value,
        sort=sort,
        all_pages=all_pages,
    )


@logs_group.command("get")
@click.argument("log_id")
@click.pass_context
def logs_get_command(ctx: click.Context, log_id: str) -> None:
    _handle_logs_get(ctx, log_id=log_id)


@logs_group.command("stats")
@click.option("--filter", "filter_value", default=None)
@click.pass_context
def logs_stats_command(ctx: click.Context, filter_value: str | None) -> None:
    _handle_logs_stats(ctx, filter_value=filter_value)


@cli.group("crons")
def crons_group() -> None:
    """Remote cron endpoints."""


@crons_group.command("list")
@click.pass_context
def crons_list_command(ctx: click.Context) -> None:
    _handle_crons_list(ctx)


@crons_group.command("run")
@click.argument("job_id")
@click.option("--yes", is_flag=True, help="Acknowledge that running a cron job can trigger side effects immediately")
@click.pass_context
def crons_run_command(ctx: click.Context, job_id: str, yes: bool) -> None:
    _handle_crons_run(ctx, job_id=job_id, yes=yes)


@cli.group("collections")
def collections_group() -> None:
    """Remote collections endpoints."""


@collections_group.command("list")
@click.option("--page", type=int, default=None)
@click.option("--per-page", type=int, default=None)
@click.option("--filter", "filter_value", default=None)
@click.option("--sort", default=None)
@click.option("--all", "all_pages", is_flag=True, help="Fetch all pages and merge them into a single result payload")
@click.pass_context
def collections_list_command(
    ctx: click.Context,
    page: int | None,
    per_page: int | None,
    filter_value: str | None,
    sort: str | None,
    all_pages: bool,
) -> None:
    _handle_collections_list(
        ctx,
        page=page,
        per_page=per_page,
        filter_value=filter_value,
        sort=sort,
        all_pages=all_pages,
    )


@collections_group.command("get")
@click.argument("name_or_id")
@click.pass_context
def collections_get_command(ctx: click.Context, name_or_id: str) -> None:
    _handle_collections_get(ctx, name_or_id=name_or_id)


@collections_group.command("create")
@click.option("--data", default=None, help="JSON object body")
@click.option("--file", "file_path", default=None, help="Path to a JSON file or `-` to read from stdin")
@click.option("--stdin-json", is_flag=True, help="Read the JSON object body from stdin")
@click.pass_context
def collections_create_command(ctx: click.Context, data: str | None, file_path: str | None, stdin_json: bool) -> None:
    _handle_collections_create(ctx, data=data, file_path=file_path, stdin_json=stdin_json)


@collections_group.command("update")
@click.argument("name_or_id")
@click.option("--data", default=None, help="JSON object body")
@click.option("--file", "file_path", default=None, help="Path to a JSON file or `-` to read from stdin")
@click.option("--stdin-json", is_flag=True, help="Read the JSON object body from stdin")
@click.pass_context
def collections_update_command(
    ctx: click.Context,
    name_or_id: str,
    data: str | None,
    file_path: str | None,
    stdin_json: bool,
) -> None:
    _handle_collections_update(ctx, name_or_id=name_or_id, data=data, file_path=file_path, stdin_json=stdin_json)


@collections_group.command("ensure")
@click.option("--data", default=None, help="JSON object body")
@click.option("--file", "file_path", default=None, help="Path to a JSON file or `-` to read from stdin")
@click.option("--stdin-json", is_flag=True, help="Read the JSON object body from stdin")
@click.option(
    "--if-exists",
    type=click.Choice(["update", "fail"], case_sensitive=False),
    default="update",
    show_default=True,
    help="Behavior when the target collection name already exists",
)
@click.option(
    "--if-missing",
    type=click.Choice(["create", "fail"], case_sensitive=False),
    default="create",
    show_default=True,
    help="Behavior when the target collection name does not exist",
)
@click.option(
    "--output",
    "output_mode",
    type=click.Choice(["summary", "full"], case_sensitive=False),
    default="full",
    show_default=True,
    help="Response detail level for successful ensure operations",
)
@click.pass_context
def collections_ensure_command(
    ctx: click.Context,
    data: str | None,
    file_path: str | None,
    stdin_json: bool,
    if_exists: str,
    if_missing: str,
    output_mode: str,
) -> None:
    _handle_collections_ensure(
        ctx,
        data=data,
        file_path=file_path,
        stdin_json=stdin_json,
        if_exists=if_exists.lower(),
        if_missing=if_missing.lower(),
        output_mode=output_mode.lower(),
    )


@collections_group.command("delete")
@click.argument("name_or_id")
@click.option("--yes", is_flag=True, help="Acknowledge that deleting a collection is destructive")
@click.pass_context
def collections_delete_command(ctx: click.Context, name_or_id: str, yes: bool) -> None:
    _handle_collections_delete(ctx, name_or_id=name_or_id, yes=yes)


@collections_group.command("truncate")
@click.argument("name_or_id")
@click.option("--yes", is_flag=True, help="Acknowledge that truncating a collection removes all records")
@click.pass_context
def collections_truncate_command(ctx: click.Context, name_or_id: str, yes: bool) -> None:
    _handle_collections_truncate(ctx, name_or_id=name_or_id, yes=yes)


@collections_group.command("import")
@click.option("--data", default=None, help="JSON object body")
@click.option("--file", "file_path", default=None, help="Path to a JSON file or `-` to read from stdin")
@click.option("--stdin-json", is_flag=True, help="Read the JSON object body from stdin")
@click.pass_context
def collections_import_command(ctx: click.Context, data: str | None, file_path: str | None, stdin_json: bool) -> None:
    _handle_collections_import(ctx, data=data, file_path=file_path, stdin_json=stdin_json)


@collections_group.command("scaffolds")
@click.pass_context
def collections_scaffolds_command(ctx: click.Context) -> None:
    _handle_collections_scaffolds(ctx)


@cli.group("records")
def records_group() -> None:
    """Remote records endpoints."""


@records_group.command("auth-methods")
@click.argument("collection")
@click.pass_context
def records_auth_methods_command(ctx: click.Context, collection: str) -> None:
    _handle_records_auth_methods(ctx, collection=collection)


@records_group.command("auth-password")
@click.argument("collection")
@click.argument("identity")
@click.argument("password")
@click.option("--identity-field", default=None, help="Optional explicit identity field, for example email or username")
@click.option("--fields", default=None)
@click.option("--expand", default=None)
@click.option("--mfa-id", default=None, help="Existing MFA Id to continue a second-step auth flow")
@click.option("--save/--no-save", "save_auth", default=True, help="Persist the returned auth token in the local session")
@click.pass_context
def records_auth_password_command(
    ctx: click.Context,
    collection: str,
    identity: str,
    password: str,
    identity_field: str | None,
    fields: str | None,
    expand: str | None,
    mfa_id: str | None,
    save_auth: bool,
) -> None:
    _handle_records_auth_password(
        ctx,
        collection=collection,
        identity=identity,
        password=password,
        identity_field=identity_field,
        fields=fields,
        expand=expand,
        mfa_id=mfa_id,
        save_auth=save_auth,
    )


@records_group.command("auth-oauth2")
@click.argument("collection")
@click.option("--provider", required=True, help="OAuth2 provider name, for example google")
@click.option("--code", required=True, help="OAuth2 authorization code returned from the provider redirect")
@click.option("--redirect-url", required=True, help="Redirect URL used during the initial OAuth2 request")
@click.option("--code-verifier", default=None, help="Optional PKCE code verifier")
@click.option("--create-data", default=None, help="Optional JSON object for first-time record creation")
@click.option("--create-file", default=None, help="Path to a JSON file for first-time record creation")
@click.option("--fields", default=None)
@click.option("--expand", default=None)
@click.option("--save/--no-save", "save_auth", default=True, help="Persist the returned auth token in the local session")
@click.pass_context
def records_auth_oauth2_command(
    ctx: click.Context,
    collection: str,
    provider: str,
    code: str,
    redirect_url: str,
    code_verifier: str | None,
    create_data: str | None,
    create_file: str | None,
    fields: str | None,
    expand: str | None,
    save_auth: bool,
) -> None:
    _handle_records_auth_oauth2(
        ctx,
        collection=collection,
        provider=provider,
        code=code,
        redirect_url=redirect_url,
        code_verifier=code_verifier,
        create_data=create_data,
        create_file=create_file,
        fields=fields,
        expand=expand,
        save_auth=save_auth,
    )


@records_group.command("auth-refresh")
@click.argument("collection")
@click.option("--fields", default=None)
@click.option("--expand", default=None)
@click.option("--save/--no-save", "save_auth", default=True, help="Persist the refreshed auth token in the local session")
@click.pass_context
def records_auth_refresh_command(
    ctx: click.Context,
    collection: str,
    fields: str | None,
    expand: str | None,
    save_auth: bool,
) -> None:
    _handle_records_auth_refresh(
        ctx,
        collection=collection,
        fields=fields,
        expand=expand,
        save_auth=save_auth,
    )


@records_group.command("request-otp")
@click.argument("collection")
@click.argument("email")
@click.pass_context
def records_request_otp_command(ctx: click.Context, collection: str, email: str) -> None:
    _handle_records_request_otp(ctx, collection=collection, email=email)


@records_group.command("auth-otp")
@click.argument("collection")
@click.argument("otp_id")
@click.argument("password")
@click.option("--fields", default=None)
@click.option("--expand", default=None)
@click.option("--mfa-id", default=None, help="Existing MFA Id to continue a second-step auth flow")
@click.option("--save/--no-save", "save_auth", default=True, help="Persist the returned auth token in the local session")
@click.pass_context
def records_auth_otp_command(
    ctx: click.Context,
    collection: str,
    otp_id: str,
    password: str,
    fields: str | None,
    expand: str | None,
    mfa_id: str | None,
    save_auth: bool,
) -> None:
    _handle_records_auth_otp(
        ctx,
        collection=collection,
        otp_id=otp_id,
        password=password,
        fields=fields,
        expand=expand,
        mfa_id=mfa_id,
        save_auth=save_auth,
    )


@records_group.command("request-password-reset")
@click.argument("collection")
@click.argument("email")
@click.pass_context
def records_request_password_reset_command(ctx: click.Context, collection: str, email: str) -> None:
    _handle_records_request_password_reset(ctx, collection=collection, email=email)


@records_group.command("confirm-password-reset")
@click.argument("collection")
@click.argument("token")
@click.argument("password")
@click.argument("password_confirm")
@click.pass_context
def records_confirm_password_reset_command(
    ctx: click.Context,
    collection: str,
    token: str,
    password: str,
    password_confirm: str,
) -> None:
    _handle_records_confirm_password_reset(
        ctx,
        collection=collection,
        token=token,
        password=password,
        password_confirm=password_confirm,
    )


@records_group.command("request-verification")
@click.argument("collection")
@click.argument("email")
@click.pass_context
def records_request_verification_command(ctx: click.Context, collection: str, email: str) -> None:
    _handle_records_request_verification(ctx, collection=collection, email=email)


@records_group.command("confirm-verification")
@click.argument("collection")
@click.argument("token")
@click.pass_context
def records_confirm_verification_command(ctx: click.Context, collection: str, token: str) -> None:
    _handle_records_confirm_verification(ctx, collection=collection, token=token)


@records_group.command("request-email-change")
@click.argument("collection")
@click.argument("new_email")
@click.pass_context
def records_request_email_change_command(ctx: click.Context, collection: str, new_email: str) -> None:
    _handle_records_request_email_change(ctx, collection=collection, new_email=new_email)


@records_group.command("confirm-email-change")
@click.argument("collection")
@click.argument("token")
@click.argument("password")
@click.pass_context
def records_confirm_email_change_command(
    ctx: click.Context,
    collection: str,
    token: str,
    password: str,
) -> None:
    _handle_records_confirm_email_change(
        ctx,
        collection=collection,
        token=token,
        password=password,
    )


@records_group.command("impersonate")
@click.argument("collection")
@click.argument("record_id")
@click.option("--duration", type=int, default=None, help="Optional static auth token duration in seconds")
@click.option("--fields", default=None)
@click.option("--expand", default=None)
@click.option("--save/--no-save", "save_auth", default=True, help="Persist the impersonation token in the local session")
@click.pass_context
def records_impersonate_command(
    ctx: click.Context,
    collection: str,
    record_id: str,
    duration: int | None,
    fields: str | None,
    expand: str | None,
    save_auth: bool,
) -> None:
    _handle_records_impersonate(
        ctx,
        collection=collection,
        record_id=record_id,
        duration=duration,
        fields=fields,
        expand=expand,
        save_auth=save_auth,
    )


@records_group.command("list")
@click.argument("collection")
@click.option("--page", type=int, default=None)
@click.option("--per-page", type=int, default=None)
@click.option("--filter", "filter_value", default=None)
@click.option("--sort", default=None)
@click.option("--fields", default=None)
@click.option("--expand", default=None)
@click.option("--all", "all_pages", is_flag=True, help="Fetch all pages and merge them into a single result payload")
@click.pass_context
def records_list_command(
    ctx: click.Context,
    collection: str,
    page: int | None,
    per_page: int | None,
    filter_value: str | None,
    sort: str | None,
    fields: str | None,
    expand: str | None,
    all_pages: bool,
) -> None:
    _handle_records_list(
        ctx,
        collection=collection,
        page=page,
        per_page=per_page,
        filter_value=filter_value,
        sort=sort,
        fields=fields,
        expand=expand,
        all_pages=all_pages,
    )


@records_group.command("get")
@click.argument("collection")
@click.argument("record_id")
@click.option("--fields", default=None)
@click.option("--expand", default=None)
@click.pass_context
def records_get_command(
    ctx: click.Context,
    collection: str,
    record_id: str,
    fields: str | None,
    expand: str | None,
) -> None:
    _handle_records_get(
        ctx,
        collection=collection,
        record_id=record_id,
        fields=fields,
        expand=expand,
    )


@records_group.command("create")
@click.argument("collection")
@click.option("--data", default=None, help="JSON object body")
@click.option("--file", "file_path", default=None, help="Path to a JSON file or `-` to read from stdin")
@click.option("--stdin-json", is_flag=True, help="Read the JSON object body from stdin")
@click.pass_context
def records_create_command(
    ctx: click.Context,
    collection: str,
    data: str | None,
    file_path: str | None,
    stdin_json: bool,
) -> None:
    _handle_records_create(ctx, collection=collection, data=data, file_path=file_path, stdin_json=stdin_json)


@records_group.command("update")
@click.argument("collection")
@click.argument("record_id")
@click.option("--data", default=None, help="JSON object body")
@click.option("--file", "file_path", default=None, help="Path to a JSON file or `-` to read from stdin")
@click.option("--stdin-json", is_flag=True, help="Read the JSON object body from stdin")
@click.pass_context
def records_update_command(
    ctx: click.Context,
    collection: str,
    record_id: str,
    data: str | None,
    file_path: str | None,
    stdin_json: bool,
) -> None:
    _handle_records_update(
        ctx,
        collection=collection,
        record_id=record_id,
        data=data,
        file_path=file_path,
        stdin_json=stdin_json,
    )


@records_group.command("delete")
@click.argument("collection")
@click.argument("record_id")
@click.option("--yes", is_flag=True, help="Acknowledge that deleting a record is destructive")
@click.pass_context
def records_delete_command(ctx: click.Context, collection: str, record_id: str, yes: bool) -> None:
    _handle_records_delete(ctx, collection=collection, record_id=record_id, yes=yes)


@records_group.command("find")
@click.argument("collection")
@click.option("--filter", "filter_value", required=True, help="PocketBase filter expression")
@click.option("--first", is_flag=True, help="Return only the first matched record")
@click.option("--per-page", type=int, default=None)
@click.option("--sort", default=None)
@click.option("--fields", default=None)
@click.option("--expand", default=None)
@click.pass_context
def records_find_command(
    ctx: click.Context,
    collection: str,
    filter_value: str,
    first: bool,
    per_page: int | None,
    sort: str | None,
    fields: str | None,
    expand: str | None,
) -> None:
    _handle_records_find(
        ctx,
        collection=collection,
        filter_value=filter_value,
        first=first,
        per_page=per_page,
        sort=sort,
        fields=fields,
        expand=expand,
    )


@records_group.command("upsert")
@click.argument("collection")
@click.option("--filter", "filter_value", required=True, help="PocketBase filter expression")
@click.option("--data", default=None, help="JSON object body")
@click.option("--file", "file_path", default=None, help="Path to a JSON file or `-` to read from stdin")
@click.option("--stdin-json", is_flag=True, help="Read the JSON object body from stdin")
@click.option("--first", is_flag=True, help="Update the first matched record when the filter matches multiple records")
@click.option("--fields", default=None)
@click.option("--expand", default=None)
@click.pass_context
def records_upsert_command(
    ctx: click.Context,
    collection: str,
    filter_value: str,
    data: str | None,
    file_path: str | None,
    stdin_json: bool,
    first: bool,
    fields: str | None,
    expand: str | None,
) -> None:
    _handle_records_upsert(
        ctx,
        collection=collection,
        filter_value=filter_value,
        data=data,
        file_path=file_path,
        stdin_json=stdin_json,
        first=first,
        fields=fields,
        expand=expand,
    )


@records_group.command("delete-by-filter")
@click.argument("collection")
@click.option("--filter", "filter_value", required=True, help="PocketBase filter expression")
@click.option("--expect-count", type=int, default=None, help="Fail unless the filter matches exactly this many records")
@click.option("--yes", is_flag=True, help="Acknowledge that filtered deletion is destructive")
@click.pass_context
def records_delete_by_filter_command(
    ctx: click.Context,
    collection: str,
    filter_value: str,
    expect_count: int | None,
    yes: bool,
) -> None:
    _handle_records_delete_by_filter(
        ctx,
        collection=collection,
        filter_value=filter_value,
        yes=yes,
        expect_count=expect_count,
    )


@cli.group("files")
def files_group() -> None:
    """Remote file helpers."""


@files_group.command("token")
@click.pass_context
def files_token_command(ctx: click.Context) -> None:
    _handle_files_token(ctx)


@cli.group("backups")
def backups_group() -> None:
    """Remote backup endpoints."""


@backups_group.command("list")
@click.pass_context
def backups_list_command(ctx: click.Context) -> None:
    _handle_backups_list(ctx)


@backups_group.command("create")
@click.option("--name", default=None, help="Optional backup archive name, for example snapshot.zip")
@click.pass_context
def backups_create_command(ctx: click.Context, name: str | None) -> None:
    _handle_backups_create(ctx, name=name)


@backups_group.command("upload")
@click.argument("file_path")
@click.pass_context
def backups_upload_command(ctx: click.Context, file_path: str) -> None:
    _handle_backups_upload(ctx, file_path=file_path)


@backups_group.command("delete")
@click.argument("name")
@click.option("--yes", is_flag=True, help="Acknowledge that deleting a backup archive is destructive")
@click.pass_context
def backups_delete_command(ctx: click.Context, name: str, yes: bool) -> None:
    _handle_backups_delete(ctx, name=name, yes=yes)


@backups_group.command("download")
@click.argument("name")
@click.option("--output", default=None, help="Destination file path. Defaults to ./<name>")
@click.option("--token", default=None, help="Optional backup file token. If omitted the CLI will fetch one automatically.")
@click.option("--overwrite", is_flag=True, help="Overwrite the destination file if it already exists")
@click.pass_context
def backups_download_command(
    ctx: click.Context,
    name: str,
    output: str | None,
    token: str | None,
    overwrite: bool,
) -> None:
    _handle_backups_download(ctx, name=name, output=output, token=token, overwrite=overwrite)


@backups_group.command("restore")
@click.argument("name")
@click.option("--yes", is_flag=True, help="Acknowledge that restore is destructive and restarts the app")
@click.pass_context
def backups_restore_command(ctx: click.Context, name: str, yes: bool) -> None:
    _handle_backups_restore(ctx, name=name, yes=yes)


@cli.group("batch")
def batch_group() -> None:
    """Remote batch helpers."""


@batch_group.command("run")
@click.option("--data", default=None, help="Batch payload JSON object")
@click.option("--file", "file_path", default=None, help="Path to a JSON file containing the batch payload")
@click.option("--stdin-json", is_flag=True, help="Read the batch payload JSON object from stdin")
@click.pass_context
def batch_run_command(ctx: click.Context, data: str | None, file_path: str | None, stdin_json: bool) -> None:
    _handle_batch_run(ctx, data=data, file_path=file_path, stdin_json=stdin_json)


@files_group.command("url")
@click.argument("collection")
@click.argument("record_id")
@click.argument("filename")
@click.option("--thumb", default=None, help="Optional PocketBase thumb spec, for example 100x100 or 300x0")
@click.option("--download", is_flag=True, help="Force download with PocketBase download=1 query flag")
@click.option("--token", default=None, help="Optional file token query parameter")
@click.option("--with-token", is_flag=True, help="Fetch a temporary file token and append it automatically")
@click.pass_context
def files_url_command(
    ctx: click.Context,
    collection: str,
    record_id: str,
    filename: str,
    thumb: str | None,
    download: bool,
    token: str | None,
    with_token: bool,
) -> None:
    _handle_files_url(
        ctx,
        collection=collection,
        record_id=record_id,
        filename=filename,
        thumb=thumb,
        download=download,
        token=token,
        with_token=with_token,
    )


@cli.group("remote", hidden=True)
def remote_group() -> None:
    """Backward-compatible alias namespace for remote API commands."""


for _remote_name, _remote_command in (
    ("settings", settings_group),
    ("logs", logs_group),
    ("crons", crons_group),
    ("collections", collections_group),
    ("records", records_group),
    ("files", files_group),
    ("backups", backups_group),
    ("batch", batch_group),
    ("raw", raw_command),
):
    remote_group.add_command(_remote_command, _remote_name)


@cli.group("config")
def config_group() -> None:
    """Persist remote defaults for future commands."""


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    emit_success(
        json_output=ctx.obj["json_output"],
        action="config.show",
        message="Current config",
        data=ctx.obj["state"].config,
    )


@config_group.command("set")
@click.argument("key")
@click.argument("value")
@click.pass_context
def config_set(ctx: click.Context, key: str, value: str) -> None:
    try:
        parsed = parse_config_value(key, value)
        payload = ctx.obj["state"].set_config(key, parsed)
    except ValueError as exc:
        emit_error(
            json_output=ctx.obj["json_output"],
            action="config.set",
            message=str(exc),
        )
        return

    _record_command(ctx, f"config set {key} {shlex.quote(value)}")
    emit_success(
        json_output=ctx.obj["json_output"],
        action="config.set",
        message="Config updated",
        data=payload,
    )


@config_group.command("unset")
@click.argument("key")
@click.pass_context
def config_unset(ctx: click.Context, key: str) -> None:
    try:
        payload = ctx.obj["state"].unset_config(key)
    except ValueError as exc:
        emit_error(
            json_output=ctx.obj["json_output"],
            action="config.unset",
            message=str(exc),
        )
        return

    _record_command(ctx, f"config unset {key}")
    emit_success(
        json_output=ctx.obj["json_output"],
        action="config.unset",
        message="Config removed",
        data=payload,
    )


@cli.command("undo")
@click.pass_context
def undo_command(ctx: click.Context) -> None:
    try:
        payload = ctx.obj["state"].undo()
    except ValueError as exc:
        emit_error(
            json_output=ctx.obj["json_output"],
            action="undo",
            message=str(exc),
        )
        return

    _record_command(ctx, "undo")
    emit_success(
        json_output=ctx.obj["json_output"],
        action="undo",
        message="Undo applied",
        data=payload,
    )


@cli.command("redo")
@click.pass_context
def redo_command(ctx: click.Context) -> None:
    try:
        payload = ctx.obj["state"].redo()
    except ValueError as exc:
        emit_error(
            json_output=ctx.obj["json_output"],
            action="redo",
            message=str(exc),
        )
        return

    _record_command(ctx, "redo")
    emit_success(
        json_output=ctx.obj["json_output"],
        action="redo",
        message="Redo applied",
        data=payload,
    )


@cli.command("history")
@click.option("--limit", default=20, show_default=True, type=int)
@click.pass_context
def history_command(ctx: click.Context, limit: int) -> None:
    items = ctx.obj["state"].command_history[-max(limit, 1) :]
    emit_success(
        json_output=ctx.obj["json_output"],
        action="history",
        message="Recent command history",
        data={"items": items},
    )


def _parse_option_values(tokens: list[str], option_names: set[str]) -> tuple[list[str], dict[str, str]]:
    positionals, options, _ = _parse_cli_tokens(tokens, option_names=option_names, flag_names=set())
    return positionals, options


def _parse_cli_tokens(
    tokens: list[str],
    *,
    option_names: set[str],
    flag_names: set[str],
) -> tuple[list[str], dict[str, str], set[str]]:
    positionals: list[str] = []
    options: dict[str, str] = {}
    flags: set[str] = set()

    idx = 0
    while idx < len(tokens):
        token = tokens[idx]
        if token in option_names:
            if idx + 1 >= len(tokens):
                raise ValueError(f"{token} requires a value")
            options[token] = tokens[idx + 1]
            idx += 2
            continue

        if token in flag_names:
            flags.add(token)
            idx += 1
            continue

        positionals.append(token)
        idx += 1

    return positionals, options, flags


def _parse_options_and_flags(
    tokens: list[str],
    option_names: set[str],
    flag_names: set[str],
) -> tuple[list[str], dict[str, str], set[str]]:
    return _parse_cli_tokens(tokens, option_names=option_names, flag_names=flag_names)


def _dispatch_resource_tokens(ctx: click.Context, tokens: list[str]) -> None:
    if not tokens:
        _emit_repl_usage(ctx, action="repl.dispatch", usage_key="root")
        return

    section = tokens[0]
    if section == "settings":
        if len(tokens) < 2:
            _emit_repl_usage(ctx, action="settings", usage_key="settings.group")
            return

        subcommand = tokens[1]
        if subcommand == "get" and len(tokens) == 2:
            _handle_settings_get(ctx, record_history=False)
            return

        if subcommand == "patch":
            _, options = _parse_option_values(tokens[2:], {"--data", "--file"})
            if "--data" not in options and "--file" not in options:
                _emit_repl_usage(ctx, action="settings.patch", usage_key="settings.patch")
                return
            if "--file" in options:
                try:
                    data = Path(options["--file"]).read_text(encoding="utf-8")
                except OSError as exc:
                    emit_error(
                        json_output=ctx.obj["json_output"],
                        action="settings.patch",
                        message=f"Failed to read JSON file: {exc}",
                    )
                    return
            else:
                data = options["--data"]
            _handle_settings_patch(ctx, data=data, record_history=False)
            return

        if subcommand == "test-s3":
            _, options = _parse_option_values(tokens[2:], {"--data", "--file"})
            _handle_settings_test_s3(
                ctx,
                data=options.get("--data"),
                file_path=options.get("--file"),
                record_history=False,
            )
            return

        if subcommand == "test-email":
            _, options = _parse_option_values(tokens[2:], {"--data", "--file"})
            _handle_settings_test_email(
                ctx,
                data=options.get("--data"),
                file_path=options.get("--file"),
                record_history=False,
            )
            return

        if subcommand == "apple-client-secret":
            _, options = _parse_option_values(tokens[2:], {"--data", "--file"})
            _handle_settings_generate_apple_client_secret(
                ctx,
                data=options.get("--data"),
                file_path=options.get("--file"),
                record_history=False,
            )
            return

        _emit_repl_usage(ctx, action="settings", usage_key="settings.summary")
        return

    if section == "logs":
        if len(tokens) < 2:
            _emit_repl_usage(ctx, action="logs", usage_key="logs.group")
            return

        subcommand = tokens[1]
        if subcommand == "list":
            _, options = _parse_option_values(tokens[2:], {"--page", "--per-page", "--filter", "--sort"})
            _handle_logs_list(
                ctx,
                page=int(options["--page"]) if "--page" in options else None,
                per_page=int(options["--per-page"]) if "--per-page" in options else None,
                filter_value=options.get("--filter"),
                sort=options.get("--sort"),
                record_history=False,
            )
            return

        if subcommand == "get" and len(tokens) == 3:
            _handle_logs_get(ctx, log_id=tokens[2], record_history=False)
            return

        if subcommand == "stats":
            _, options = _parse_option_values(tokens[2:], {"--filter"})
            _handle_logs_stats(
                ctx,
                filter_value=options.get("--filter"),
                record_history=False,
            )
            return

        _emit_repl_usage(ctx, action="logs", usage_key="logs.summary")
        return

    if section == "crons":
        if len(tokens) < 2:
            _emit_repl_usage(ctx, action="crons", usage_key="crons.group")
            return

        subcommand = tokens[1]
        if subcommand == "list" and len(tokens) == 2:
            _handle_crons_list(ctx, record_history=False)
            return

        if subcommand == "run" and len(tokens) == 3:
            _handle_crons_run(ctx, job_id=tokens[2], record_history=False)
            return

        _emit_repl_usage(ctx, action="crons", usage_key="crons.summary")
        return

    if section == "collections":
        if len(tokens) < 2:
            _emit_repl_usage(ctx, action="collections", usage_key="collections.group")
            return

        subcommand = tokens[1]
        if subcommand == "list":
            _, options = _parse_option_values(tokens[2:], {"--page", "--per-page", "--filter", "--sort"})
            _handle_collections_list(
                ctx,
                page=int(options["--page"]) if "--page" in options else None,
                per_page=int(options["--per-page"]) if "--per-page" in options else None,
                filter_value=options.get("--filter"),
                sort=options.get("--sort"),
                record_history=False,
            )
            return

        if subcommand == "get" and len(tokens) == 3:
            _handle_collections_get(ctx, name_or_id=tokens[2], record_history=False)
            return

        if subcommand == "create":
            _, options = _parse_option_values(tokens[2:], {"--data", "--file"})
            _handle_collections_create(
                ctx,
                data=options.get("--data"),
                file_path=options.get("--file"),
                record_history=False,
            )
            return

        if subcommand == "update":
            positionals, options = _parse_option_values(tokens[2:], {"--data", "--file"})
            if len(positionals) != 1:
                _emit_repl_usage(ctx, action="collections.update", usage_key="collections.update")
                return
            _handle_collections_update(
                ctx,
                name_or_id=positionals[0],
                data=options.get("--data"),
                file_path=options.get("--file"),
                record_history=False,
            )
            return

        if subcommand == "delete" and len(tokens) == 3:
            _handle_collections_delete(ctx, name_or_id=tokens[2], record_history=False)
            return

        if subcommand == "truncate" and len(tokens) == 3:
            _handle_collections_truncate(ctx, name_or_id=tokens[2], record_history=False)
            return

        if subcommand == "import":
            _, options = _parse_option_values(tokens[2:], {"--data", "--file"})
            _handle_collections_import(
                ctx,
                data=options.get("--data"),
                file_path=options.get("--file"),
                record_history=False,
            )
            return

        if subcommand == "scaffolds" and len(tokens) == 2:
            _handle_collections_scaffolds(ctx, record_history=False)
            return

        _emit_repl_usage(ctx, action="collections", usage_key="collections.summary")
        return

    if section == "records":
        if len(tokens) < 2:
            _emit_repl_usage(ctx, action="records", usage_key="records.group")
            return

        subcommand = tokens[1]
        if subcommand == "auth-methods" and len(tokens) == 3:
            _handle_records_auth_methods(ctx, collection=tokens[2], record_history=False)
            return

        if subcommand == "auth-password":
            positionals, options, flags = _parse_options_and_flags(
                tokens[2:],
                {"--identity-field", "--fields", "--expand", "--mfa-id"},
                {"--save", "--no-save"},
            )
            if len(positionals) != 3:
                _emit_repl_usage(ctx, action="records.auth-password", usage_key="records.auth-password")
                return
            _handle_records_auth_password(
                ctx,
                collection=positionals[0],
                identity=positionals[1],
                password=positionals[2],
                identity_field=options.get("--identity-field"),
                fields=options.get("--fields"),
                expand=options.get("--expand"),
                mfa_id=options.get("--mfa-id"),
                save_auth="--no-save" not in flags,
                record_history=False,
            )
            return

        if subcommand == "auth-oauth2":
            positionals, options, flags = _parse_options_and_flags(
                tokens[2:],
                {"--provider", "--code", "--redirect-url", "--code-verifier", "--create-data", "--create-file", "--fields", "--expand"},
                {"--save", "--no-save"},
            )
            if len(positionals) != 1 or "--provider" not in options or "--code" not in options or "--redirect-url" not in options:
                _emit_repl_usage(ctx, action="records.auth-oauth2", usage_key="records.auth-oauth2")
                return
            _handle_records_auth_oauth2(
                ctx,
                collection=positionals[0],
                provider=options["--provider"],
                code=options["--code"],
                redirect_url=options["--redirect-url"],
                code_verifier=options.get("--code-verifier"),
                create_data=options.get("--create-data"),
                create_file=options.get("--create-file"),
                fields=options.get("--fields"),
                expand=options.get("--expand"),
                save_auth="--no-save" not in flags,
                record_history=False,
            )
            return

        if subcommand == "auth-refresh":
            positionals, options, flags = _parse_options_and_flags(
                tokens[2:],
                {"--fields", "--expand"},
                {"--save", "--no-save"},
            )
            if len(positionals) != 1:
                _emit_repl_usage(ctx, action="records.auth-refresh", usage_key="records.auth-refresh")
                return
            _handle_records_auth_refresh(
                ctx,
                collection=positionals[0],
                fields=options.get("--fields"),
                expand=options.get("--expand"),
                save_auth="--no-save" not in flags,
                record_history=False,
            )
            return

        if subcommand == "request-otp" and len(tokens) == 4:
            _handle_records_request_otp(
                ctx,
                collection=tokens[2],
                email=tokens[3],
                record_history=False,
            )
            return

        if subcommand == "auth-otp":
            positionals, options, flags = _parse_options_and_flags(
                tokens[2:],
                {"--fields", "--expand", "--mfa-id"},
                {"--save", "--no-save"},
            )
            if len(positionals) != 3:
                _emit_repl_usage(ctx, action="records.auth-otp", usage_key="records.auth-otp")
                return
            _handle_records_auth_otp(
                ctx,
                collection=positionals[0],
                otp_id=positionals[1],
                password=positionals[2],
                fields=options.get("--fields"),
                expand=options.get("--expand"),
                mfa_id=options.get("--mfa-id"),
                save_auth="--no-save" not in flags,
                record_history=False,
            )
            return

        if subcommand == "request-password-reset" and len(tokens) == 4:
            _handle_records_request_password_reset(
                ctx,
                collection=tokens[2],
                email=tokens[3],
                record_history=False,
            )
            return

        if subcommand == "confirm-password-reset" and len(tokens) == 6:
            _handle_records_confirm_password_reset(
                ctx,
                collection=tokens[2],
                token=tokens[3],
                password=tokens[4],
                password_confirm=tokens[5],
                record_history=False,
            )
            return

        if subcommand == "request-verification" and len(tokens) == 4:
            _handle_records_request_verification(
                ctx,
                collection=tokens[2],
                email=tokens[3],
                record_history=False,
            )
            return

        if subcommand == "confirm-verification" and len(tokens) == 4:
            _handle_records_confirm_verification(
                ctx,
                collection=tokens[2],
                token=tokens[3],
                record_history=False,
            )
            return

        if subcommand == "request-email-change" and len(tokens) == 4:
            _handle_records_request_email_change(
                ctx,
                collection=tokens[2],
                new_email=tokens[3],
                record_history=False,
            )
            return

        if subcommand == "confirm-email-change" and len(tokens) == 5:
            _handle_records_confirm_email_change(
                ctx,
                collection=tokens[2],
                token=tokens[3],
                password=tokens[4],
                record_history=False,
            )
            return

        if subcommand == "impersonate":
            positionals, options, flags = _parse_options_and_flags(
                tokens[2:],
                {"--duration", "--fields", "--expand"},
                {"--save", "--no-save"},
            )
            if len(positionals) != 2:
                _emit_repl_usage(ctx, action="records.impersonate", usage_key="records.impersonate")
                return
            _handle_records_impersonate(
                ctx,
                collection=positionals[0],
                record_id=positionals[1],
                duration=int(options["--duration"]) if "--duration" in options else None,
                fields=options.get("--fields"),
                expand=options.get("--expand"),
                save_auth="--no-save" not in flags,
                record_history=False,
            )
            return

        if subcommand == "list":
            positionals, options = _parse_option_values(
                tokens[2:],
                {"--page", "--per-page", "--filter", "--sort", "--fields", "--expand"},
            )
            if len(positionals) != 1:
                _emit_repl_usage(ctx, action="records.list", usage_key="records.list")
                return
            _handle_records_list(
                ctx,
                collection=positionals[0],
                page=int(options["--page"]) if "--page" in options else None,
                per_page=int(options["--per-page"]) if "--per-page" in options else None,
                filter_value=options.get("--filter"),
                sort=options.get("--sort"),
                fields=options.get("--fields"),
                expand=options.get("--expand"),
                record_history=False,
            )
            return

        if subcommand == "get":
            positionals, options = _parse_option_values(tokens[2:], {"--fields", "--expand"})
            if len(positionals) != 2:
                _emit_repl_usage(ctx, action="records.get", usage_key="records.get")
                return
            _handle_records_get(
                ctx,
                collection=positionals[0],
                record_id=positionals[1],
                fields=options.get("--fields"),
                expand=options.get("--expand"),
                record_history=False,
            )
            return

        if subcommand == "create":
            positionals, options = _parse_option_values(tokens[2:], {"--data"})
            if len(positionals) != 1 or "--data" not in options:
                _emit_repl_usage(ctx, action="records.create", usage_key="records.create")
                return
            _handle_records_create(
                ctx,
                collection=positionals[0],
                data=options["--data"],
                record_history=False,
            )
            return

        if subcommand == "update":
            positionals, options = _parse_option_values(tokens[2:], {"--data"})
            if len(positionals) != 2 or "--data" not in options:
                _emit_repl_usage(ctx, action="records.update", usage_key="records.update")
                return
            _handle_records_update(
                ctx,
                collection=positionals[0],
                record_id=positionals[1],
                data=options["--data"],
                record_history=False,
            )
            return

        if subcommand == "delete" and len(tokens) == 4:
            _handle_records_delete(
                ctx,
                collection=tokens[2],
                record_id=tokens[3],
                record_history=False,
            )
            return

        _emit_repl_usage(ctx, action="records", usage_key="records.summary")
        return

    if section == "files":
        if len(tokens) < 2:
            _emit_repl_usage(ctx, action="files", usage_key="files.group")
            return

        subcommand = tokens[1]
        if subcommand == "token" and len(tokens) == 2:
            _handle_files_token(ctx, record_history=False)
            return

        if subcommand == "url":
            positionals, options, flags = _parse_options_and_flags(
                tokens[2:],
                {"--thumb", "--token"},
                {"--download", "--with-token"},
            )
            if len(positionals) != 3:
                _emit_repl_usage(ctx, action="files.url", usage_key="files.url")
                return
            _handle_files_url(
                ctx,
                collection=positionals[0],
                record_id=positionals[1],
                filename=positionals[2],
                thumb=options.get("--thumb"),
                download="--download" in flags,
                token=options.get("--token"),
                with_token="--with-token" in flags,
                record_history=False,
            )
            return

        _emit_repl_usage(ctx, action="files", usage_key="files.summary")
        return

    if section == "batch":
        if len(tokens) < 2:
            _emit_repl_usage(ctx, action="batch", usage_key="batch.group")
            return

        subcommand = tokens[1]
        if subcommand == "run":
            _, options = _parse_option_values(tokens[2:], {"--data", "--file"})
            _handle_batch_run(
                ctx,
                data=options.get("--data"),
                file_path=options.get("--file"),
                record_history=False,
            )
            return

        _emit_repl_usage(ctx, action="batch", usage_key="batch.group")
        return

    if section == "backups":
        if len(tokens) < 2:
            _emit_repl_usage(ctx, action="backups", usage_key="backups.group")
            return

        subcommand = tokens[1]
        if subcommand == "list" and len(tokens) == 2:
            _handle_backups_list(ctx, record_history=False)
            return

        if subcommand == "create":
            _, options = _parse_option_values(tokens[2:], {"--name"})
            _handle_backups_create(
                ctx,
                name=options.get("--name"),
                record_history=False,
            )
            return

        if subcommand == "upload" and len(tokens) == 3:
            _handle_backups_upload(
                ctx,
                file_path=tokens[2],
                record_history=False,
            )
            return

        if subcommand == "download":
            positionals, options, flags = _parse_options_and_flags(
                tokens[2:],
                {"--output", "--token"},
                {"--overwrite"},
            )
            if len(positionals) != 1:
                _emit_repl_usage(ctx, action="backups.download", usage_key="backups.download")
                return
            _handle_backups_download(
                ctx,
                name=positionals[0],
                output=options.get("--output"),
                token=options.get("--token"),
                overwrite="--overwrite" in flags,
                record_history=False,
            )
            return

        if subcommand == "restore":
            positionals, _, flags = _parse_options_and_flags(
                tokens[2:],
                set(),
                {"--yes"},
            )
            if len(positionals) != 1:
                _emit_repl_usage(ctx, action="backups.restore", usage_key="backups.restore")
                return
            _handle_backups_restore(
                ctx,
                name=positionals[0],
                yes="--yes" in flags,
                record_history=False,
            )
            return

        if subcommand == "delete" and len(tokens) == 3:
            _handle_backups_delete(ctx, name=tokens[2], record_history=False)
            return

        _emit_repl_usage(ctx, action="backups", usage_key="backups.summary")
        return

    if section == "raw":
        positionals, options = _parse_option_values(tokens[1:], {"--data"})
        if len(positionals) != 2:
            _emit_repl_usage(ctx, action="raw", usage_key="raw")
            return
        _handle_raw(
            ctx,
            method=positionals[0],
            path=positionals[1],
            data=options.get("--data"),
            record_history=False,
        )
        return

    emit_error(
        json_output=ctx.obj["json_output"],
        action="repl.dispatch",
        message=f"Unknown command: {section}",
    )


def _dispatch_repl(ctx: click.Context, tokens: list[str]) -> dict[str, Any] | None:
    cmd = tokens[0]

    if cmd == "info":
        _handle_info(ctx, record_history=False)
        return None

    if cmd == "auth":
        if len(tokens) < 2:
            _emit_repl_usage(ctx, action="auth", usage_key="auth.group")
            return None

        subcommand = tokens[1]
        if subcommand == "login":
            positionals, options = _parse_option_values(tokens[2:], {"--base-url", "--collection"})
            if len(positionals) != 2:
                _emit_repl_usage(ctx, action="auth.login", usage_key="auth.login")
                return None

            _handle_auth_login(
                ctx,
                base_url=options.get("--base-url"),
                identity=positionals[0],
                password=positionals[1],
                collection=options.get("--collection"),
                record_history=False,
            )
            return None

        if subcommand == "logout":
            _handle_auth_logout(ctx, record_history=False)
            return None

        if subcommand == "status":
            _handle_auth_status(ctx, record_history=False)
            return None

        if subcommand == "whoami":
            _handle_auth_whoami(ctx, record_history=False)
            return None

        if subcommand == "refresh":
            _handle_auth_refresh(ctx, record_history=False)
            return None

        emit_error(
            json_output=ctx.obj["json_output"],
            action="auth",
            message=f"Unknown auth command: {subcommand}",
        )
        return None

    if cmd == "remote":
        _dispatch_resource_tokens(ctx, tokens[1:])
        return None

    _dispatch_resource_tokens(ctx, tokens)
    return None


if __name__ == "__main__":
    cli()
