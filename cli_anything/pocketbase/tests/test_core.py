from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from cli_anything.pocketbase.pocketbase_cli import _parse_batch_payload
from cli_anything.pocketbase.core.session import SessionStore, parse_config_value
from cli_anything.pocketbase.core.repl import _sanitize_history_tokens
from cli_anything.pocketbase.utils.pocketbase_remote import PocketBaseRemoteClient, PocketBaseRemoteError


class SessionStateTests(unittest.TestCase):
    def test_set_undo_redo_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            store = SessionStore(path=Path(tmp_dir) / "session.json")
            state = store.load()

            first = state.set_config("base_url", "https://pb.example.com")
            second = state.set_config("timeout", 15)

            self.assertTrue(first["changed"])
            self.assertTrue(second["changed"])
            self.assertEqual(state.config["base_url"], "https://pb.example.com")
            self.assertEqual(state.config["timeout"], 15)

            undo_payload = state.undo()
            self.assertEqual(undo_payload["key"], "timeout")
            self.assertNotIn("timeout", state.config)

            redo_payload = state.redo()
            self.assertEqual(redo_payload["key"], "timeout")
            self.assertEqual(state.config["timeout"], 15)

            store.save(state)
            loaded = store.load()
            self.assertEqual(loaded.config["base_url"], "https://pb.example.com")
            self.assertEqual(loaded.config["timeout"], 15)

    def test_remote_auth_persistence(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            store = SessionStore(path=Path(tmp_dir) / "session.json")
            state = store.load()

            payload = state.set_remote_auth(
                base_url="https://pb.example.com/",
                token="secret-token",
                record={"id": "superuser_1", "email": "admin@example.com"},
            )
            self.assertEqual(payload["base_url"], "https://pb.example.com")
            self.assertTrue(state.has_remote_auth())

            store.save(state)
            loaded = store.load()
            self.assertEqual(loaded.remote_auth["base_url"], "https://pb.example.com")
            self.assertEqual(loaded.remote_auth["record"]["id"], "superuser_1")

            loaded.clear_remote_auth()
            self.assertFalse(loaded.has_remote_auth())

    def test_parse_config_values(self) -> None:
        self.assertEqual(parse_config_value("base_url", "https://pb.example.com/"), "https://pb.example.com")
        self.assertEqual(parse_config_value("auth_collection", "_superusers"), "_superusers")
        self.assertEqual(parse_config_value("timeout", "30"), 30)
        self.assertIsNone(parse_config_value("base_url", "unset"))

        with self.assertRaises(ValueError):
            parse_config_value("timeout", "fast")

        with self.assertRaises(ValueError):
            parse_config_value("missingKey", "value")


class RemoteClientTests(unittest.TestCase):
    def test_build_url_encodes_query(self) -> None:
        client = PocketBaseRemoteClient(base_url="https://pb.example.com", timeout=5)
        url = client._build_url("/api/collections", {"page": 1, "filter": 'name = "users"'})
        self.assertEqual(url, "https://pb.example.com/api/collections?page=1&filter=name+%3D+%22users%22")

    def test_build_file_url_encodes_path_and_query(self) -> None:
        client = PocketBaseRemoteClient(base_url="https://pb.example.com")
        url = client.build_file_url(
            collection="users",
            record_id="rec_1",
            filename="avatar image.png",
            thumb="100x100",
            download=True,
            token="file-token",
        )
        self.assertEqual(
            url,
            "https://pb.example.com/api/files/users/rec_1/avatar%20image.png?thumb=100x100&download=1&token=file-token",
        )

    def test_build_backup_url_encodes_name_and_query(self) -> None:
        client = PocketBaseRemoteClient(base_url="https://pb.example.com")
        url = client.build_backup_url(name="@nightly backup.zip", token="file-token")
        self.assertEqual(
            url,
            "https://pb.example.com/api/backups/%40nightly%20backup.zip?token=file-token",
        )

    def test_remote_client_sets_non_python_default_user_agent(self) -> None:
        client = PocketBaseRemoteClient(base_url="https://pb.example.com")
        self.assertEqual(client.user_agent, "cli-anything-pocketbase/0.1")

    def test_request_requires_token_when_requested(self) -> None:
        client = PocketBaseRemoteClient(base_url="https://pb.example.com")

        with self.assertRaises(PocketBaseRemoteError) as ctx:
            client.request("GET", "/api/collections", require_auth=True)

        self.assertEqual(ctx.exception.status, 401)
        self.assertIn("auth login", str(ctx.exception))


class BatchPayloadTests(unittest.TestCase):
    def test_parse_batch_payload_accepts_supported_record_actions(self) -> None:
        payload = _parse_batch_payload(
            {
                "requests": [
                    {"method": "POST", "url": "/api/collections/users/records", "body": {"email": "a@example.com"}},
                    {"method": "PATCH", "url": "/api/collections/users/records/rec1", "body": {"name": "Updated"}},
                    {"method": "DELETE", "url": "/api/collections/users/records/rec1"},
                    {"method": "PUT", "url": "/api/collections/users/records?fields=id", "body": {"id": "rec2"}},
                ]
            }
        )

        self.assertEqual(len(payload["requests"]), 4)

    def test_parse_batch_payload_rejects_unsupported_actions(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            _parse_batch_payload({"requests": [{"method": "GET", "url": "/api/health"}]})

        self.assertIn("supported record actions", str(ctx.exception))


class ReplHistoryTests(unittest.TestCase):
    def test_sanitize_history_tokens_redacts_sensitive_auth_commands(self) -> None:
        self.assertEqual(
            _sanitize_history_tokens(["auth", "login", "admin@example.com", "Secret123"]),
            "auth login admin@example.com ********",
        )
        self.assertEqual(
            _sanitize_history_tokens(
                ["records", "confirm-password-reset", "users", "token123", "NewPass123!", "NewPass123!"]
            ),
            "records confirm-password-reset users ******** ******** ********",
        )
        self.assertEqual(
            _sanitize_history_tokens(
                [
                    "records",
                    "auth-oauth2",
                    "users",
                    "--provider",
                    "google",
                    "--code",
                    "oauth-code",
                    "--redirect-url",
                    "https://app.example.com/callback",
                    "--code-verifier",
                    "verifier123",
                ]
            ),
            "records auth-oauth2 users --provider google --code ******** --redirect-url https://app.example.com/callback --code-verifier ********",
        )

    def test_sanitize_history_tokens_keeps_identity_for_password_stdin_login(self) -> None:
        self.assertEqual(
            _sanitize_history_tokens(["auth", "login", "--password-stdin", "admin@example.com"]),
            "auth login --password-stdin admin@example.com",
        )


if __name__ == "__main__":
    unittest.main()
