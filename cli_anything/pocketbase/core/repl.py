from __future__ import annotations

import json
import shlex
import sys
from collections.abc import Callable
from typing import Any

import click

from cli_anything.pocketbase.core.session import SessionState, parse_config_value

ReplDispatcher = Callable[[list[str]], dict[str, Any] | None]
StateSaver = Callable[[], None]

_BUILTIN_HELP_LINES = (
    "Built-in REPL commands:",
    "  help                              Show this help",
    "  exit | quit                       Exit REPL",
    "  history                           Show command history",
    "  config show                       Show persisted remote defaults",
    "  config set <key> <value>          Persist remote default value",
    "  config unset <key>                Remove persisted remote default",
    "  undo                              Undo last config set/unset",
    "  redo                              Redo last undone config change",
)
_REMOTE_HELP_EXAMPLES = (
    "  info",
    "  config set base_url https://pb.example.com",
    "  auth login admin@example.com Secret123",
    "  auth status",
    "  auth whoami",
    "  settings get",
    "  settings test-s3 --data '{\"filesystem\":\"storage\"}'",
    "  logs list --per-page 5",
    "  logs stats --filter 'data.status>200'",
    "  crons list",
    "  collections list",
    "  collections scaffolds",
    "  records auth-methods users",
    "  records auth-password users test@example.com Secret123",
    "  records auth-oauth2 users --provider google --code XXX --redirect-url https://app.example.com/callback",
    "  records request-password-reset users test@example.com",
    "  records request-verification users test@example.com",
    "  records impersonate users RECORD_ID",
    "  records list users",
    "  batch run --file requests.json",
    "  files token",
    "  files url users RECORD_ID avatar.png --with-token",
    "  backups list",
    "  backups upload ./snapshot.zip",
    "  backups download nightly.zip --output /tmp/nightly.zip",
    "  backups restore nightly.zip --yes",
    "  raw GET /api/health",
)


def _build_help_text() -> str:
    return "\n".join((*_BUILTIN_HELP_LINES, "", "PocketBase remote mode examples:", *_REMOTE_HELP_EXAMPLES))


def _sanitize_history_tokens(tokens: list[str]) -> str:
    if not tokens:
        return ""

    rendered = list(tokens)

    if len(tokens) >= 2 and tokens[0] == "auth" and tokens[1] == "login":
        if "--password-stdin" not in tokens:
            rendered[-1] = "********"
        return " ".join(rendered)

    if len(tokens) >= 2 and tokens[0] == "records":
        subcommand = tokens[1]
        if subcommand in {"auth-password", "auth-otp"} and len(tokens) >= 5:
            rendered[-1] = "********"
        elif subcommand == "auth-oauth2":
            for index, token in enumerate(rendered[:-1]):
                if token in {"--code", "--code-verifier", "--create-data"}:
                    rendered[index + 1] = "********"
        elif subcommand == "confirm-password-reset" and len(tokens) >= 6:
            for index in (3, 4, 5):
                rendered[index] = "********"
        elif subcommand == "confirm-verification" and len(tokens) >= 4:
            rendered[3] = "********"
        elif subcommand == "confirm-email-change" and len(tokens) >= 5:
            rendered[3] = "********"
            rendered[4] = "********"

    return " ".join(rendered)


class PocketBaseRepl:
    def __init__(
        self,
        *,
        state: SessionState,
        dispatch: ReplDispatcher,
        save_state: StateSaver,
        json_output: bool,
    ) -> None:
        self.state = state
        self.dispatch = dispatch
        self.save_state = save_state
        self.json_output = json_output

    def run(self) -> None:
        self._emit(
            ok=True,
            action="repl.start",
            message="PocketBase REPL started. Type 'help' for commands.",
            data={"json_mode": self.json_output},
        )

        while True:
            try:
                line = self._read_line()
            except EOFError:
                self._emit(ok=True, action="repl.exit", message="Bye.")
                return
            except KeyboardInterrupt:
                click.echo("", err=False)
                self._emit(ok=True, action="repl.interrupt", message="Interrupted.")
                continue

            line = line.strip()
            if not line:
                continue

            try:
                tokens = shlex.split(line)
            except ValueError as exc:
                self._emit(ok=False, action="repl.parse", message=str(exc))
                continue

            if not tokens:
                continue

            self.state.record_command(_sanitize_history_tokens(tokens))
            self.save_state()

            command = tokens[0]
            if command in {"exit", "quit"}:
                self._emit(ok=True, action="repl.exit", message="Bye.")
                return

            if command in {"help", "?"}:
                self._show_help()
                continue

            if command == "history":
                self._emit(
                    ok=True,
                    action="history",
                    message="Command history",
                    data={"items": self.state.command_history},
                )
                continue

            if command == "undo":
                try:
                    payload = self.state.undo()
                    self.save_state()
                    self._emit(ok=True, action="undo", message="Undo applied", data=payload)
                except ValueError as exc:
                    self._emit(ok=False, action="undo", message=str(exc))
                continue

            if command == "redo":
                try:
                    payload = self.state.redo()
                    self.save_state()
                    self._emit(ok=True, action="redo", message="Redo applied", data=payload)
                except ValueError as exc:
                    self._emit(ok=False, action="redo", message=str(exc))
                continue

            if command == "config":
                self._handle_config(tokens[1:])
                continue

            try:
                self.dispatch(tokens)
            except Exception as exc:  # noqa: BLE001 - keep REPL alive
                self._emit(ok=False, action="repl.dispatch", message=str(exc))

    def _read_line(self) -> str:
        if not self.json_output:
            return input("pocketbase> ")

        raw = sys.stdin.readline()
        if raw == "":
            raise EOFError
        return raw.rstrip("\n")

    def _show_help(self) -> None:
        self._emit(ok=True, action="help", message=_build_help_text())

    def _handle_config(self, tokens: list[str]) -> None:
        if not tokens or tokens[0] == "show":
            self._emit(
                ok=True,
                action="config.show",
                message="Current config",
                data=self.state.config,
            )
            return

        if tokens[0] == "set":
            if len(tokens) < 3:
                self._emit(ok=False, action="config.set", message="Usage: config set <key> <value>")
                return
            key = tokens[1]
            raw_value = " ".join(tokens[2:])
            try:
                value = parse_config_value(key, raw_value)
                payload = self.state.set_config(key, value)
                self.save_state()
                self._emit(ok=True, action="config.set", message="Config updated", data=payload)
            except ValueError as exc:
                self._emit(ok=False, action="config.set", message=str(exc))
            return

        if tokens[0] == "unset":
            if len(tokens) != 2:
                self._emit(ok=False, action="config.unset", message="Usage: config unset <key>")
                return
            key = tokens[1]
            try:
                payload = self.state.unset_config(key)
                self.save_state()
                self._emit(ok=True, action="config.unset", message="Config removed", data=payload)
            except ValueError as exc:
                self._emit(ok=False, action="config.unset", message=str(exc))
            return

        self._emit(ok=False, action="config", message="Unknown config command")

    def _emit(
        self,
        *,
        ok: bool,
        action: str,
        message: str,
        data: Any = None,
    ) -> None:
        if self.json_output:
            payload = {
                "ok": ok,
                "action": action,
                "message": message,
            }
            if data is not None:
                payload["data"] = data
            click.echo(json.dumps(payload, ensure_ascii=False))
            return

        stream_err = not ok
        click.echo(message, err=stream_err)
        if data is not None:
            click.echo(json.dumps(data, indent=2, ensure_ascii=False), err=stream_err)
