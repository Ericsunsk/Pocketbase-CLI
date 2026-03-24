import json
from typing import Any

import click

SCHEMA_VERSION = "pocketbase-cli/v1"


def _stringify_data(data: Any) -> str:
    if data is None:
        return ""
    if isinstance(data, str):
        return data
    return json.dumps(data, indent=2, ensure_ascii=False)


def _extract_http_payload(data: Any) -> dict[str, Any] | None:
    if not isinstance(data, dict):
        return None
    if {"method", "url", "status"}.issubset(data):
        method = data.get("method")
        url = data.get("url")
        status = data.get("status")
        if isinstance(method, str) and isinstance(url, str) and isinstance(status, int):
            return {
                "method": method,
                "url": url,
                "status": status,
            }
    return None


def _extract_result_payload(data: Any) -> Any:
    if not isinstance(data, dict):
        return data
    if {"method", "url", "status", "data"}.issubset(data):
        return data.get("data")
    return data


def _extract_pagination_payload(result: Any) -> dict[str, Any] | None:
    if not isinstance(result, dict):
        return None
    items = result.get("items")
    if not isinstance(items, list):
        return None

    page = result.get("page")
    per_page = result.get("perPage")
    total_items = result.get("totalItems")
    total_pages = result.get("totalPages")
    fetched_all = result.get("fetchedAll")
    fetched_pages = result.get("fetchedPages")
    next_page = result.get("nextPage")

    has_more = False
    if isinstance(next_page, int):
        has_more = True
    elif isinstance(page, int) and isinstance(total_pages, int):
        has_more = page < total_pages

    return {
        "page": page,
        "per_page": per_page,
        "total_items": total_items,
        "total_pages": total_pages,
        "item_count": len(items),
        "has_more": has_more,
        "next_page": next_page,
        "fetched_all": bool(fetched_all) if fetched_all is not None else False,
        "fetched_pages": fetched_pages,
    }


def _infer_error_type(*, code: int, message: str, http_status: int | None, missing_prerequisite: str | None) -> str:
    lowered = message.lower()
    if missing_prerequisite:
        return "missing_prerequisite"
    if lowered.startswith("usage:"):
        return "usage_error"
    if "destructive" in lowered or "--yes" in lowered:
        return "confirmation_required"
    if "invalid json" in lowered or "must include" in lowered or "expects " in lowered or "use exactly one of" in lowered:
        return "invalid_input"
    if http_status == 401:
        return "unauthorized"
    if http_status == 403:
        return "forbidden"
    if http_status == 404:
        return "not_found"
    if http_status is not None and http_status >= 500:
        return "remote_http_error"
    if code >= 500:
        return "remote_http_error"
    return "runtime_error"


def _infer_retryable(*, code: int, http_status: int | None) -> bool:
    if http_status is not None:
        return http_status in {408, 429} or http_status >= 500
    return code >= 500


def _build_meta(*, action: str, code: int | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "command": action,
    }
    if code is not None:
        payload["exit_code"] = code
    return payload


def emit_success(
    *,
    json_output: bool,
    action: str,
    message: str,
    data: Any = None,
) -> dict[str, Any]:
    http = _extract_http_payload(data)
    result_payload = _extract_result_payload(data)
    pagination = _extract_pagination_payload(result_payload)
    payload: dict[str, Any] = {
        "ok": True,
        "schema_version": SCHEMA_VERSION,
        "command": action,
        "action": action,
        "message": message,
        "meta": _build_meta(action=action),
    }
    if data is not None:
        payload["data"] = data
        payload["result"] = data
    if http is not None:
        payload["http"] = http
    if pagination is not None:
        payload["pagination"] = pagination

    if json_output:
        click.echo(json.dumps(payload, ensure_ascii=False))
    else:
        click.echo(message)
        rendered = _stringify_data(data)
        if rendered:
            click.echo(rendered)

    return payload


def emit_error(
    *,
    json_output: bool,
    action: str,
    message: str,
    code: int = 1,
    data: Any = None,
    error_type: str | None = None,
    hint: str | None = None,
    retryable: bool | None = None,
    missing_prerequisite: str | None = None,
    http_status: int | None = None,
) -> None:
    http = _extract_http_payload(data)
    resolved_http_status = http_status if http_status is not None else (http.get("status") if http else None)
    payload: dict[str, Any] = {
        "ok": False,
        "schema_version": SCHEMA_VERSION,
        "command": action,
        "action": action,
        "message": message,
        "code": code,
        "meta": _build_meta(action=action, code=code),
        "error": {
            "type": error_type or _infer_error_type(
                code=code,
                message=message,
                http_status=resolved_http_status,
                missing_prerequisite=missing_prerequisite,
            ),
            "retryable": retryable if retryable is not None else _infer_retryable(code=code, http_status=resolved_http_status),
            "message": message,
            "hint": hint,
            "missing_prerequisite": missing_prerequisite,
            "http_status": resolved_http_status,
        },
    }
    if data is not None:
        payload["data"] = data
    if http is not None:
        payload["http"] = http

    if json_output:
        click.echo(json.dumps(payload, ensure_ascii=False))
    else:
        click.echo(message, err=True)
        rendered = _stringify_data(data)
        if rendered:
            click.echo(rendered, err=True)

    raise click.exceptions.Exit(code=code)
