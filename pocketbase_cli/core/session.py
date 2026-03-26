from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

STATE_DIR_ENV = "POCKETBASE_CLI_STATE_DIR"
DEFAULT_STATE_DIR = Path("~/.cache/pocketbase-cli").expanduser()
DEFAULT_SESSION_PATH = "session.json"

INT_CONFIG_KEYS = {"timeout"}
ALLOWED_CONFIG_KEYS = {
    "base_url",
    "auth_collection",
    "timeout",
}


@dataclass
class SessionState:
    config: dict[str, Any] = field(default_factory=dict)
    remote_auth: dict[str, Any] = field(default_factory=dict)
    command_history: list[str] = field(default_factory=list)
    undo_stack: list[dict[str, Any]] = field(default_factory=list)
    redo_stack: list[dict[str, Any]] = field(default_factory=list)
    max_history: int = 200

    def record_command(self, command_line: str) -> None:
        command_line = command_line.strip()
        if not command_line:
            return
        self.command_history.append(command_line)
        if len(self.command_history) > self.max_history:
            self.command_history = self.command_history[-self.max_history :]

    def set_config(self, key: str, value: Any) -> dict[str, Any]:
        if key not in ALLOWED_CONFIG_KEYS:
            raise ValueError(f"Unknown config key: {key}")

        old_value = self.config.get(key)
        if old_value == value:
            return {
                "changed": False,
                "key": key,
                "old": old_value,
                "new": value,
            }

        change = {
            "key": key,
            "old": old_value,
            "new": value,
        }
        if value is None:
            self.config.pop(key, None)
        else:
            self.config[key] = value

        self.undo_stack.append(change)
        self.redo_stack.clear()

        return {
            "changed": True,
            **change,
        }

    def unset_config(self, key: str) -> dict[str, Any]:
        return self.set_config(key, None)

    def undo(self) -> dict[str, Any]:
        if not self.undo_stack:
            raise ValueError("Nothing to undo")

        change = self.undo_stack.pop()
        key = change["key"]
        old_value = change["old"]

        if old_value is None:
            self.config.pop(key, None)
        else:
            self.config[key] = old_value

        self.redo_stack.append(change)
        return {
            "key": key,
            "value": old_value,
            "change": change,
        }

    def redo(self) -> dict[str, Any]:
        if not self.redo_stack:
            raise ValueError("Nothing to redo")

        change = self.redo_stack.pop()
        key = change["key"]
        new_value = change["new"]

        if new_value is None:
            self.config.pop(key, None)
        else:
            self.config[key] = new_value

        self.undo_stack.append(change)
        return {
            "key": key,
            "value": new_value,
            "change": change,
        }

    def set_remote_auth(
        self,
        *,
        base_url: str,
        token: str,
        record: dict[str, Any] | None,
        collection: str = "_superusers",
    ) -> dict[str, Any]:
        self.remote_auth = {
            "base_url": base_url.rstrip("/"),
            "token": token,
            "record": dict(record or {}),
            "collection": collection,
        }
        return dict(self.remote_auth)

    def clear_remote_auth(self) -> None:
        self.remote_auth = {}

    def has_remote_auth(self) -> bool:
        return bool(self.remote_auth.get("base_url") and self.remote_auth.get("token"))

    def to_dict(self) -> dict[str, Any]:
        return {
            "config": self.config,
            "remote_auth": self.remote_auth,
            "command_history": self.command_history,
            "undo_stack": self.undo_stack,
            "redo_stack": self.redo_stack,
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> SessionState:
        return cls(
            config=dict(raw.get("config", {})),
            remote_auth=dict(raw.get("remote_auth", {})),
            command_history=list(raw.get("command_history", [])),
            undo_stack=list(raw.get("undo_stack", [])),
            redo_stack=list(raw.get("redo_stack", [])),
        )


class SessionStore:
    def __init__(self, path: Path | None = None) -> None:
        configured_dir = os.environ.get(STATE_DIR_ENV)
        base_dir = Path(configured_dir).expanduser() if configured_dir else DEFAULT_STATE_DIR
        self.path = path or (base_dir / DEFAULT_SESSION_PATH)

    def load(self) -> SessionState:
        if not self.path.exists():
            return SessionState()

        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return SessionState()

        if not isinstance(raw, dict):
            return SessionState()

        return SessionState.from_dict(raw)

    def save(self, state: SessionState) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            json.dumps(state.to_dict(), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass


def parse_config_value(key: str, raw: str) -> Any:
    if key not in ALLOWED_CONFIG_KEYS:
        raise ValueError(f"Unknown config key: {key}")

    lower = raw.strip().lower()
    if lower in {"none", "null", "unset"}:
        return None

    if key in INT_CONFIG_KEYS:
        try:
            return int(raw)
        except ValueError as exc:
            raise ValueError(f"{key} expects an integer value") from exc

    if key == "base_url":
        return raw.rstrip("/")

    return raw.strip()
