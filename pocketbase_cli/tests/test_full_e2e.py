from __future__ import annotations

import copy
import json
import os
import re
import site
import shutil
import subprocess
import sysconfig
import tempfile
import threading
import unittest
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from pocketbase_cli.core.session import STATE_DIR_ENV

_AUTH_REQUIRED_MESSAGE = "The request requires valid record authorization."
_SUPERUSER_REQUIRED_MESSAGE = "The request requires superuser authorization."
_VALIDATION_ERROR_MESSAGE = "An error occurred while validating the submitted data."
_AUTH_FAILED_MESSAGE = "Failed to authenticate."


class _RemoteFixture:
    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self.initial_token = "pb-token-initial"
        self.refreshed_token = "pb-token-refreshed"
        self.file_token = "pb-file-token"
        self.current_token = self.initial_token
        self.current_identity = "superuser"
        self.superuser_record = {
            "id": "superuser_1",
            "email": "admin@example.com",
            "collectionName": "_superusers",
        }
        self.user_auth_token = "pb-user-token"
        self.user_refreshed_token = "pb-user-token-refreshed"
        self.impersonation_token = "pb-user-token-static"
        self.user_password = "UserPass123!"
        self.user_new_password = "NewPass123!"
        self.mfa_password = "MfaPass123!"
        self.user_password_reset_token = "pb-reset-token"
        self.user_verification_token = "pb-verify-token"
        self.user_email_change_token = "pb-email-change-token"
        self.user_otp_id = "otp_auth_1"
        self.user_mfa_id = "mfa_auth_1"
        self.pending_email_change = "changed@example.com"
        self.password_reset_requests: list[str] = []
        self.verification_requests: list[str] = []
        self.email_change_requests: list[str] = []
        self.otp_requests: list[str] = []
        self.user_auth_record = {
            "id": "user_auth_1",
            "email": "test@example.com",
            "username": "testuser",
            "verified": False,
            "collectionName": "users",
        }
        self.user_auth_methods = {
            "password": {
                "enabled": True,
                "identityFields": ["email", "username"],
            },
            "oauth2": {
                "enabled": True,
                "providers": [
                    {
                        "name": "google",
                        "displayName": "Google",
                        "state": "oauth-state",
                        "authURL": "https://accounts.example.com/auth?client_id=test&redirect_uri=",
                        "authUrl": "https://accounts.example.com/auth?client_id=test&redirect_uri=",
                        "codeVerifier": "oauth-code-verifier",
                        "codeChallenge": "oauth-code-challenge",
                        "codeChallengeMethod": "S256",
                    }
                ],
            },
            "mfa": {
                "enabled": True,
                "duration": 1800,
            },
            "otp": {
                "enabled": True,
                "duration": 300,
            },
            "authProviders": [
                {
                    "name": "google",
                    "displayName": "Google",
                    "state": "oauth-state",
                    "authURL": "https://accounts.example.com/auth?client_id=test&redirect_uri=",
                    "authUrl": "https://accounts.example.com/auth?client_id=test&redirect_uri=",
                    "codeVerifier": "oauth-code-verifier",
                    "codeChallenge": "oauth-code-challenge",
                    "codeChallengeMethod": "S256",
                }
            ],
            "usernamePassword": True,
            "emailPassword": True,
        }
        self.collection = {
            "id": "collection_users",
            "name": "users",
            "type": "auth",
        }
        self.collections = {
            "users": dict(self.collection),
        }
        self.collection_scaffolds = {
            "base": {
                "type": "base",
                "fields": [{"name": "title", "type": "text"}],
            },
            "auth": {
                "type": "auth",
                "fields": [{"name": "email", "type": "email"}],
            },
        }
        self.records = {
            "seed_1": {
                "id": "seed_1",
                "email": "seed@example.com",
                "name": "Seed User",
            },
        }
        self.settings = {
            "meta": {"appName": "PocketBase Test"},
            "logs": {"maxDays": 7},
            "smtp": {"enabled": False},
            "s3": {"enabled": False},
            "backups": {"cron": ""},
            "batch": {"enabled": True},
        }
        self.logs = [
            {
                "id": "873f2133-9f38-44fb-bf82-c8f53b310d91",
                "message": "first log",
                "data": {"status": 200},
            },
            {
                "id": "f2133873-44fb-9f38-bf82-c918f53b310d",
                "message": "second log",
                "data": {"status": 503},
            },
        ]
        self.log_stats = [
            {"date": "2022-05-01 10:00:00.000Z", "total": 1},
            {"date": "2022-05-02 10:00:00.000Z", "total": 1},
        ]
        self.backups = [
            "test1.zip",
            "@test4.zip",
        ]
        self.backup_content = {
            "test1.zip": b"backup-test1-zip-bytes",
            "@test4.zip": b"backup-escaped-zip-bytes",
        }
        self.restored_backup: str | None = None
        self.crons = [
            {"id": "__pbLogsCleanup__", "expression": "0 */6 * * *"},
            {"id": "test", "expression": "* * * * *"},
        ]
        self.cron_runs: list[str] = []
        self.sent_test_emails: list[dict[str, object]] = []
        self.generated_apple_secret = "apple-secret-token"
        self._next_id = 2
        self._next_collection_id = 2

    def is_authorized(self, token: str | None) -> bool:
        return token == self.current_token

    def has_superuser_auth(self, token: str | None) -> bool:
        return self.is_authorized(token) and self.current_identity == "superuser"

    def has_record_auth(self, token: str | None) -> bool:
        return self.is_authorized(token) and self.current_identity == "record"

    def next_record_id(self) -> str:
        record_id = f"rec_{self._next_id}"
        self._next_id += 1
        return record_id

    def next_collection_id(self) -> str:
        collection_id = f"collection_{self._next_collection_id}"
        self._next_collection_id += 1
        return collection_id


class _PocketBaseRemoteHandler(BaseHTTPRequestHandler):
    server_version = "PocketBaseTest/1.0"

    @property
    def fixture(self) -> _RemoteFixture:
        return self.server.fixture  # type: ignore[attr-defined]

    def log_message(self, format: str, *args: object) -> None:  # noqa: A003
        return

    def _read_json(self) -> dict[str, object]:
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length <= 0:
            return {}

        raw = self.rfile.read(content_length).decode("utf-8")
        if not raw:
            return {}

        return json.loads(raw)

    def _read_body_bytes(self) -> bytes:
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length <= 0:
            return b""
        return self.rfile.read(content_length)

    def _read_multipart_form(self) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
        content_type = self.headers.get("Content-Type", "")
        boundary_match = re.search(r"boundary=([^;]+)", content_type)
        if "multipart/form-data" not in content_type or not boundary_match:
            raise ValueError(_VALIDATION_ERROR_MESSAGE)

        boundary = boundary_match.group(1).strip().strip('"').encode("utf-8")
        raw = self._read_body_bytes()
        text_fields: dict[str, list[str]] = {}
        file_fields: dict[str, list[str]] = {}

        for part in raw.split(b"--" + boundary):
            normalized = part.strip()
            if not normalized or normalized == b"--":
                continue

            normalized = normalized.strip(b"\r\n")
            if not normalized or normalized == b"--":
                continue

            if b"\r\n\r\n" not in normalized:
                continue

            header_bytes, body = normalized.split(b"\r\n\r\n", 1)
            body = body.rsplit(b"\r\n", 1)[0]

            name_match = re.search(rb'name="([^"]+)"', header_bytes)
            if not name_match:
                continue

            field_name = name_match.group(1).decode("utf-8", errors="replace")
            filename_match = re.search(rb'filename="([^"]+)"', header_bytes)
            if filename_match:
                filename = filename_match.group(1).decode("utf-8", errors="replace")
                file_fields.setdefault(field_name, []).append(filename)
            else:
                value = body.decode("utf-8", errors="replace")
                text_fields.setdefault(field_name, []).append(value)

        return text_fields, file_fields

    @staticmethod
    def _decode_form_value(raw: str) -> object:
        stripped = raw.strip()
        if not stripped:
            return ""
        try:
            return json.loads(stripped)
        except json.JSONDecodeError:
            return raw

    @staticmethod
    def _normalize_file_values(value: object) -> list[str]:
        if value is None:
            return []
        if isinstance(value, list):
            return [str(item) for item in value]
        return [str(value)]

    def _apply_multipart_record_mutations(
        self,
        *,
        record: dict[str, object],
        text_fields: dict[str, list[str]],
        file_fields: dict[str, list[str]],
    ) -> None:
        for field_name, values in text_fields.items():
            if field_name.endswith("-"):
                target_field = field_name[:-1]
                current_values = self._normalize_file_values(record.get(target_field))
                targets: list[str] = []
                for raw_value in values:
                    decoded = self._decode_form_value(raw_value)
                    if isinstance(decoded, list):
                        targets.extend(str(item) for item in decoded)
                    else:
                        targets.append(str(decoded))
                target_set = set(targets)
                record[target_field] = [item for item in current_values if item not in target_set]
                continue

            decoded_values = [self._decode_form_value(raw_value) for raw_value in values]
            record[field_name] = decoded_values[0] if len(decoded_values) == 1 else decoded_values

        for field_name, filenames in file_fields.items():
            if field_name.endswith("+"):
                target_field = field_name[:-1]
                current_values = self._normalize_file_values(record.get(target_field))
                current_values.extend(filenames)
                record[target_field] = current_values
                continue

            record[field_name] = filenames[0] if len(filenames) == 1 else filenames

    def _write_json(self, status: int, payload: object) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _write_empty(self, status: int) -> None:
        self.send_response(status)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _write_binary(self, status: int, payload: bytes, content_type: str = "application/octet-stream") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _require_auth(self) -> bool:
        if self.fixture.is_authorized(self.headers.get("Authorization")):
            return True

        self._write_json(
            401,
            {"message": _AUTH_REQUIRED_MESSAGE},
        )
        return False

    def _require_superuser_auth(self) -> bool:
        if not self._require_auth():
            return False
        if self.fixture.has_superuser_auth(self.headers.get("Authorization")):
            return True
        self._write_json(403, {"message": _SUPERUSER_REQUIRED_MESSAGE})
        return False

    def _require_record_auth(self) -> bool:
        if not self._require_auth():
            return False
        if self.fixture.has_record_auth(self.headers.get("Authorization")):
            return True
        self._write_json(403, {"message": _AUTH_REQUIRED_MESSAGE})
        return False

    def _apply_batch_request(self, item: dict[str, object], working_records: dict[str, dict[str, object]]) -> dict[str, object]:
        method = str(item.get("method", "")).upper()
        raw_url = str(item.get("url", ""))
        path = urllib.parse.urlparse(raw_url).path
        body = item.get("body") if isinstance(item.get("body"), dict) else {}

        if path == "/api/collections/users/records":
            if method == "POST":
                record_id = self.fixture.next_record_id()
                record = {"id": record_id, **body}
                working_records[record_id] = record
                return {"status": 200, "body": record}

            if method == "PUT":
                record_id = body.get("id") if isinstance(body, dict) else None
                if isinstance(record_id, str) and record_id in working_records:
                    working_records[record_id].update(body)
                    return {"status": 200, "body": working_records[record_id]}

                new_record_id = record_id if isinstance(record_id, str) and record_id else self.fixture.next_record_id()
                record = {"id": new_record_id, **body}
                working_records[new_record_id] = record
                return {"status": 200, "body": record}

        if path.startswith("/api/collections/users/records/"):
            record_id = path.rsplit("/", 1)[-1]
            if record_id not in working_records:
                raise ValueError("Record not found")

            if method == "PATCH":
                if isinstance(body, dict):
                    working_records[record_id].update(body)
                return {"status": 200, "body": working_records[record_id]}

            if method == "DELETE":
                deleted = working_records.pop(record_id)
                return {"status": 204, "body": deleted}

        raise ValueError("Batch action not supported")

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/health":
            self._write_json(200, {"code": 200, "message": "ok"})
            return

        if path == "/api/collections/users/auth-methods":
            self._write_json(200, self.fixture.user_auth_methods)
            return

        if path == "/api/collections":
            if not self._require_auth():
                return
            query = urllib.parse.parse_qs(parsed.query)
            page = int(query.get("page", ["1"])[0])
            per_page = int(query.get("perPage", ["30"])[0])
            items = list(self.fixture.collections.values())
            self._write_json(
                200,
                {
                    "page": page,
                    "perPage": per_page,
                    "totalItems": len(items),
                    "items": items,
                },
            )
            return

        if path == "/api/collections/meta/scaffolds":
            if not self._require_auth():
                return
            self._write_json(200, self.fixture.collection_scaffolds)
            return

        if path == "/api/crons":
            if not self._require_auth():
                return
            self._write_json(200, self.fixture.crons)
            return

        if path.startswith("/api/collections/") and not path.endswith("/records") and "/records/" not in path:
            if not self._require_auth():
                return
            collection_key = urllib.parse.unquote(path.rsplit("/", 1)[-1])
            collection = self.fixture.collections.get(collection_key)
            if collection is None:
                self._write_json(404, {"message": "Collection not found"})
                return
            self._write_json(200, collection)
            return

        if path == "/api/settings":
            if not self._require_auth():
                return
            self._write_json(200, self.fixture.settings)
            return

        if path == "/api/backups":
            if not self._require_auth():
                return
            self._write_json(200, self.fixture.backups)
            return

        if path.startswith("/api/backups/"):
            token = urllib.parse.parse_qs(parsed.query).get("token", [None])[0]
            if token != self.fixture.file_token:
                self._write_json(403, {"message": "Insufficient permissions to access the resource."})
                return

            name = urllib.parse.unquote(path.rsplit("/", 1)[-1])
            content = self.fixture.backup_content.get(name)
            if content is None:
                self._write_json(404, {"message": "Backup not found"})
                return

            self._write_binary(200, content, content_type="application/zip")
            return

        if path == "/api/logs":
            if not self._require_auth():
                return
            query = urllib.parse.parse_qs(parsed.query)
            page = int(query.get("page", ["1"])[0])
            per_page = int(query.get("perPage", ["30"])[0])
            filter_value = query.get("filter", [None])[0]
            items = list(self.fixture.logs)
            if filter_value == "data.status>200":
                items = [item for item in items if int(item.get("data", {}).get("status", 0)) > 200]
            self._write_json(
                200,
                {
                    "page": page,
                    "perPage": per_page,
                    "totalItems": len(items),
                    "items": items[:per_page],
                },
            )
            return

        if path == "/api/logs/stats":
            if not self._require_auth():
                return
            filter_value = urllib.parse.parse_qs(parsed.query).get("filter", [None])[0]
            items = list(self.fixture.log_stats)
            if filter_value == "data.status>200":
                items = items[1:]
            self._write_json(200, items)
            return

        if path.startswith("/api/logs/"):
            if not self._require_auth():
                return
            log_id = path.rsplit("/", 1)[-1]
            for item in self.fixture.logs:
                if item["id"] == log_id:
                    self._write_json(200, item)
                    return
            self._write_json(404, {"message": "Log not found"})
            return

        if path == "/api/collections/users/records":
            if not self._require_auth():
                return
            query = urllib.parse.parse_qs(parsed.query)
            page = max(int(query.get("page", ["1"])[0]), 1)
            per_page = max(int(query.get("perPage", ["30"])[0]), 1)
            filter_value = query.get("filter", [None])[0]
            items = list(self.fixture.records.values())
            if isinstance(filter_value, str) and filter_value:
                match = re.fullmatch(r"\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*['\"]([^'\"]+)['\"]\s*", filter_value)
                if match:
                    field_name = match.group(1)
                    expected_value = match.group(2)
                    items = [item for item in items if str(item.get(field_name, "")) == expected_value]
            total = len(items)
            start = (page - 1) * per_page
            end = start + per_page
            self._write_json(
                200,
                {
                    "page": page,
                    "perPage": per_page,
                    "totalItems": total,
                    "items": items[start:end],
                },
            )
            return

        if path.startswith("/api/collections/users/records/"):
            if not self._require_auth():
                return
            record_id = path.rsplit("/", 1)[-1]
            record = self.fixture.records.get(record_id)
            if record is None:
                self._write_json(404, {"message": "Record not found"})
                return
            self._write_json(200, record)
            return

        self._write_json(404, {"message": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        path = urllib.parse.urlparse(self.path).path

        if path == "/api/backups/upload":
            if not self._require_superuser_auth():
                return

            content_type = self.headers.get("Content-Type", "")
            content_length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(content_length) if content_length > 0 else b""
            if "multipart/form-data" not in content_type:
                self._write_json(400, {"message": _VALIDATION_ERROR_MESSAGE})
                return

            filename_match = re.search(rb'filename="([^"]+)"', raw)
            if not filename_match:
                self._write_json(400, {"message": _VALIDATION_ERROR_MESSAGE})
                return

            filename = filename_match.group(1).decode("utf-8", errors="replace")
            if filename in self.fixture.backups:
                self._write_json(400, {"message": "Backup file with the specified name already exists."})
                return
            if not filename.endswith(".zip"):
                self._write_json(400, {"message": _VALIDATION_ERROR_MESSAGE})
                return

            boundary_match = re.search(r"boundary=([^;]+)", content_type)
            if boundary_match:
                boundary = boundary_match.group(1).encode("utf-8")
                file_bytes = b""
                for part in raw.split(b"--" + boundary):
                    if b'filename="' not in part:
                        continue
                    if b"\r\n\r\n" not in part:
                        continue
                    _, body = part.split(b"\r\n\r\n", 1)
                    file_bytes = body.rsplit(b"\r\n", 1)[0]
                    break
            else:
                file_bytes = raw

            self.fixture.backups.append(filename)
            self.fixture.backup_content[filename] = file_bytes
            self._write_empty(204)
            return

        if path == "/api/collections/users/records" and "multipart/form-data" in self.headers.get("Content-Type", ""):
            if not self._require_auth():
                return
            try:
                text_fields, file_fields = self._read_multipart_form()
            except ValueError:
                self._write_json(400, {"message": _VALIDATION_ERROR_MESSAGE})
                return

            record_id = self.fixture.next_record_id()
            record: dict[str, object] = {"id": record_id}
            self._apply_multipart_record_mutations(
                record=record,
                text_fields=text_fields,
                file_fields=file_fields,
            )
            self.fixture.records[record_id] = record
            self._write_json(200, record)
            return

        payload = self._read_json()

        if path == "/api/collections/_superusers/auth-with-password":
            if payload.get("identity") != "admin@example.com" or payload.get("password") != "Secret123":
                self._write_json(400, {"message": _AUTH_FAILED_MESSAGE})
                return
            self.fixture.current_token = self.fixture.initial_token
            self.fixture.current_identity = "superuser"
            self._write_json(
                200,
                {
                    "token": self.fixture.initial_token,
                    "record": self.fixture.superuser_record,
                },
            )
            return

        if path == "/api/collections/_superusers/auth-refresh":
            if not self._require_auth():
                return
            self.fixture.current_token = self.fixture.refreshed_token
            self.fixture.current_identity = "superuser"
            self._write_json(
                200,
                {
                    "token": self.fixture.refreshed_token,
                    "record": self.fixture.superuser_record,
                },
            )
            return

        if path == "/api/collections/users/auth-with-password":
            identity = payload.get("identity") if isinstance(payload, dict) else None
            password = payload.get("password") if isinstance(payload, dict) else None
            mfa_id = payload.get("mfaId") if isinstance(payload, dict) else None
            if identity == "mfa@example.com" and password == self.fixture.mfa_password and not mfa_id:
                self._write_json(401, {"mfaId": self.fixture.user_mfa_id})
                return
            valid_identities = {
                str(self.fixture.user_auth_record["email"]),
                str(self.fixture.user_auth_record["username"]),
                "mfa@example.com",
            }
            if identity not in valid_identities or password not in {
                self.fixture.user_password,
                self.fixture.user_new_password,
                self.fixture.mfa_password,
            }:
                self._write_json(400, {"message": _AUTH_FAILED_MESSAGE})
                return
            self.fixture.current_token = self.fixture.user_auth_token
            self.fixture.current_identity = "record"
            self._write_json(
                200,
                {
                    "token": self.fixture.user_auth_token,
                    "record": self.fixture.user_auth_record,
                },
            )
            return

        if path == "/api/collections/users/auth-with-oauth2":
            provider = payload.get("provider") if isinstance(payload, dict) else None
            code = payload.get("code") if isinstance(payload, dict) else None
            redirect_url = payload.get("redirectURL") if isinstance(payload, dict) else None
            if provider != "google" or not isinstance(code, str) or not isinstance(redirect_url, str) or not redirect_url:
                self._write_json(400, {"message": "An error occurred while loading the submitted data."})
                return
            if code == "oauth-mfa" and payload.get("mfaId") is None:
                self._write_json(401, {"mfaId": self.fixture.user_mfa_id})
                return

            create_data = payload.get("createData") if isinstance(payload.get("createData"), dict) else {}
            self.fixture.current_token = self.fixture.user_auth_token
            self.fixture.current_identity = "record"
            if code == "oauth-new" and create_data:
                if "name" in create_data:
                    self.fixture.user_auth_record["name"] = create_data["name"]
                meta = {
                    "id": "oauth_google_new",
                    "email": "oauth@example.com",
                    "isNew": True,
                }
            else:
                meta = {
                    "id": "oauth_google_existing",
                    "email": self.fixture.user_auth_record["email"],
                    "isNew": False,
                }
            self._write_json(
                200,
                {
                    "token": self.fixture.user_auth_token,
                    "record": self.fixture.user_auth_record,
                    "meta": meta,
                },
            )
            return

        if path == "/api/collections/users/auth-refresh":
            if not self._require_record_auth():
                return
            self.fixture.current_token = self.fixture.user_refreshed_token
            self.fixture.current_identity = "record"
            self._write_json(
                200,
                {
                    "token": self.fixture.user_refreshed_token,
                    "record": self.fixture.user_auth_record,
                },
            )
            return

        if path == "/api/collections/users/request-otp":
            email = payload.get("email") if isinstance(payload, dict) else None
            if not isinstance(email, str) or not email:
                self._write_json(400, {"message": "Invalid OTP request payload"})
                return
            self.fixture.otp_requests.append(email)
            self._write_json(200, {"otpId": self.fixture.user_otp_id})
            return

        if path == "/api/collections/users/auth-with-otp":
            otp_id = payload.get("otpId") if isinstance(payload, dict) else None
            password = payload.get("password") if isinstance(payload, dict) else None
            mfa_id = payload.get("mfaId") if isinstance(payload, dict) else None
            if otp_id == "otp_mfa" and password == "654321" and not mfa_id:
                self._write_json(401, {"mfaId": self.fixture.user_mfa_id})
                return
            if otp_id != self.fixture.user_otp_id or password != "654321":
                self._write_json(400, {"message": "Invalid or expired OTP"})
                return
            self.fixture.current_token = self.fixture.user_auth_token
            self.fixture.current_identity = "record"
            self._write_json(
                200,
                {
                    "token": self.fixture.user_auth_token,
                    "record": self.fixture.user_auth_record,
                },
            )
            return

        if path == "/api/collections/users/request-password-reset":
            email = payload.get("email") if isinstance(payload, dict) else None
            if not isinstance(email, str) or not email:
                self._write_json(400, {"message": "Invalid password reset payload"})
                return
            self.fixture.password_reset_requests.append(email)
            self._write_empty(204)
            return

        if path == "/api/collections/users/confirm-password-reset":
            token = payload.get("token") if isinstance(payload, dict) else None
            password = payload.get("password") if isinstance(payload, dict) else None
            password_confirm = payload.get("passwordConfirm") if isinstance(payload, dict) else None
            if token != self.fixture.user_password_reset_token or password != password_confirm or not isinstance(password, str):
                self._write_json(400, {"message": "Invalid or expired password reset token."})
                return
            self.fixture.user_password = password
            self._write_empty(204)
            return

        if path == "/api/collections/users/request-verification":
            email = payload.get("email") if isinstance(payload, dict) else None
            if not isinstance(email, str) or not email:
                self._write_json(400, {"message": "Invalid verification payload"})
                return
            self.fixture.verification_requests.append(email)
            self._write_empty(204)
            return

        if path == "/api/collections/users/confirm-verification":
            token = payload.get("token") if isinstance(payload, dict) else None
            if token != self.fixture.user_verification_token:
                self._write_json(400, {"message": "Invalid or expired verification token."})
                return
            self.fixture.user_auth_record["verified"] = True
            self._write_empty(204)
            return

        if path == "/api/collections/users/request-email-change":
            if not self._require_record_auth():
                return
            new_email = payload.get("newEmail") if isinstance(payload, dict) else None
            if not isinstance(new_email, str) or not new_email:
                self._write_json(400, {"message": "Invalid email change payload"})
                return
            self.fixture.pending_email_change = new_email
            self.fixture.email_change_requests.append(new_email)
            self._write_empty(204)
            return

        if path == "/api/collections/users/confirm-email-change":
            token = payload.get("token") if isinstance(payload, dict) else None
            password = payload.get("password") if isinstance(payload, dict) else None
            if token != self.fixture.user_email_change_token or password != self.fixture.user_password:
                self._write_json(400, {"message": "Invalid or expired token."})
                return
            self.fixture.user_auth_record["email"] = self.fixture.pending_email_change
            self.fixture.user_auth_record["verified"] = True
            self._write_empty(204)
            return

        if path == "/api/collections/users/impersonate/user_auth_1":
            if not self._require_superuser_auth():
                return
            duration = payload.get("duration") if isinstance(payload, dict) else None
            if duration is not None and (not isinstance(duration, int) or duration < 0):
                self._write_json(400, {"message": _VALIDATION_ERROR_MESSAGE})
                return
            self.fixture.current_token = self.fixture.impersonation_token
            self.fixture.current_identity = "record"
            self._write_json(
                200,
                {
                    "token": self.fixture.impersonation_token,
                    "record": self.fixture.user_auth_record,
                },
            )
            return

        if path == "/api/files/token":
            if not self._require_auth():
                return
            self._write_json(
                200,
                {
                    "token": self.fixture.file_token,
                },
            )
            return

        if path == "/api/settings/test/s3":
            if not self._require_auth():
                return
            filesystem = payload.get("filesystem") if isinstance(payload, dict) else None
            if filesystem not in {"storage", "backups"}:
                self._write_json(400, {"message": "Invalid filesystem"})
                return
            self._write_empty(204)
            return

        if path == "/api/settings/test/email":
            if not self._require_auth():
                return
            email = payload.get("email") if isinstance(payload, dict) else None
            template = payload.get("template") if isinstance(payload, dict) else None
            if not isinstance(email, str) or not email or not isinstance(template, str) or not template:
                self._write_json(400, {"message": "Invalid email test payload"})
                return
            self.fixture.sent_test_emails.append(payload)
            self._write_empty(204)
            return

        if path == "/api/settings/apple/generate-client-secret":
            if not self._require_auth():
                return
            required = {"clientId", "teamId", "keyId", "privateKey", "duration"}
            if not isinstance(payload, dict) or any(key not in payload for key in required):
                self._write_json(400, {"message": "Invalid apple client secret payload"})
                return
            self._write_json(200, {"secret": self.fixture.generated_apple_secret})
            return

        if path == "/api/crons/test":
            if not self._require_auth():
                return
            self.fixture.cron_runs.append("test")
            self._write_empty(204)
            return

        if path.startswith("/api/crons/"):
            if not self._require_auth():
                return
            self._write_json(404, {"message": "Cron job not found"})
            return

        if path == "/api/collections":
            if not self._require_auth():
                return
            name = payload.get("name") if isinstance(payload, dict) else None
            if not isinstance(name, str) or not name:
                self._write_json(400, {"message": "Collection name is required"})
                return
            collection = {
                "id": self.fixture.next_collection_id(),
                **payload,
            }
            self.fixture.collections[name] = collection
            self._write_json(200, collection)
            return

        if path == "/api/backups":
            if not self._require_auth():
                return
            name = payload.get("name") if isinstance(payload, dict) else None
            if not isinstance(name, str) or not name.strip():
                name = f"pb_backup_{len(self.fixture.backups) + 1}.zip"
            self.fixture.backups.append(name)
            self.fixture.backup_content[name] = f"backup-{name}".encode("utf-8")
            self._write_empty(204)
            return

        if path.startswith("/api/backups/") and path.endswith("/restore"):
            if not self._require_auth():
                return
            name = urllib.parse.unquote(path[len("/api/backups/") : -len("/restore")])
            if name not in self.fixture.backups:
                self._write_json(400, {"message": "Missing or invalid backup file."})
                return
            self.fixture.restored_backup = name
            self._write_empty(204)
            return

        if path == "/api/batch":
            if not self._require_auth():
                return
            requests = payload.get("requests") if isinstance(payload, dict) else None
            if not isinstance(requests, list) or not requests:
                self._write_json(400, {"message": "Failed to read the submitted batch data."})
                return

            working_records = copy.deepcopy(self.fixture.records)
            results: list[dict[str, object]] = []
            for index, item in enumerate(requests):
                if not isinstance(item, dict):
                    self._write_json(
                        400,
                        {
                            "message": "Batch transaction failed.",
                            "data": {
                                "requests": {
                                    str(index): {
                                        "code": "batch_request_failed",
                                        "message": "Batch request failed.",
                                        "response": {"message": "Batch request must be an object"},
                                    }
                                }
                            },
                        },
                    )
                    return

                try:
                    results.append(self._apply_batch_request(item, working_records))
                except ValueError as exc:
                    self._write_json(
                        400,
                        {
                            "message": "Batch transaction failed.",
                            "data": {
                                "requests": {
                                    str(index): {
                                        "code": "batch_request_failed",
                                        "message": "Batch request failed.",
                                        "response": {"message": str(exc)},
                                    }
                                }
                            },
                        },
                    )
                    return

            self.fixture.records = working_records
            self._write_json(200, results)
            return

        if path == "/api/collections/users/records":
            if not self._require_auth():
                return
            record_id = self.fixture.next_record_id()
            record: dict[str, object] = {"id": record_id, **payload}
            self.fixture.records[record_id] = record
            self._write_json(200, record)
            return

        self._write_json(404, {"message": "Not found"})

    def do_PATCH(self) -> None:  # noqa: N802
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/settings":
            if not self._require_auth():
                return

            payload = self._read_json()
            for key, value in payload.items():
                self.fixture.settings[key] = value
            self._write_json(200, self.fixture.settings)
            return

        if path.startswith("/api/collections/") and "/records/" not in path:
            if not self._require_auth():
                return

            collection_key = urllib.parse.unquote(path.rsplit("/", 1)[-1])
            collection = self.fixture.collections.get(collection_key)
            if collection is None:
                self._write_json(404, {"message": "Collection not found"})
                return

            payload = self._read_json()
            collection.update(payload)
            new_name = payload.get("name") if isinstance(payload, dict) else None
            if isinstance(new_name, str) and new_name and new_name != collection_key:
                self.fixture.collections.pop(collection_key, None)
                self.fixture.collections[new_name] = collection
            self._write_json(200, collection)
            return

        if not path.startswith("/api/collections/users/records/"):
            self._write_json(404, {"message": "Not found"})
            return

        if not self._require_auth():
            return

        record_id = path.rsplit("/", 1)[-1]
        record = self.fixture.records.get(record_id)
        if record is None:
            self._write_json(404, {"message": "Record not found"})
            return

        if "multipart/form-data" in self.headers.get("Content-Type", ""):
            try:
                text_fields, file_fields = self._read_multipart_form()
            except ValueError:
                self._write_json(400, {"message": _VALIDATION_ERROR_MESSAGE})
                return
            self._apply_multipart_record_mutations(
                record=record,
                text_fields=text_fields,
                file_fields=file_fields,
            )
        else:
            record.update(self._read_json())
        self._write_json(200, record)

    def do_PUT(self) -> None:  # noqa: N802
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/collections/import":
            if not self._require_auth():
                return

            payload = self._read_json()
            collections = payload.get("collections") if isinstance(payload, dict) else None
            if not isinstance(collections, list):
                self._write_json(400, {"message": "Invalid collections import payload"})
                return

            imported: dict[str, dict[str, object]] = {}
            for item in collections:
                if not isinstance(item, dict):
                    continue
                name = item.get("name")
                if not isinstance(name, str) or not name:
                    continue
                imported[name] = {"id": item.get("id") or self.fixture.next_collection_id(), **item}

            self.fixture.collections.update(imported)
            self._write_empty(204)
            return

        self._write_json(404, {"message": "Not found"})

    def do_DELETE(self) -> None:  # noqa: N802
        path = urllib.parse.urlparse(self.path).path
        if path.startswith("/api/backups/"):
            if not self._require_auth():
                return

            name = urllib.parse.unquote(path.rsplit("/", 1)[-1])
            if name not in self.fixture.backups:
                self._write_json(400, {"message": "Backup not found"})
                return

            self.fixture.backups.remove(name)
            self.fixture.backup_content.pop(name, None)
            self._write_empty(204)
            return

        if path.endswith("/truncate") and path.startswith("/api/collections/"):
            if not self._require_auth():
                return

            collection_key = urllib.parse.unquote(path[len("/api/collections/") : -len("/truncate")])
            if collection_key not in self.fixture.collections:
                self._write_json(404, {"message": "Collection not found"})
                return

            if collection_key == "users":
                self.fixture.records = {}
            self._write_empty(204)
            return

        if path.startswith("/api/collections/") and "/records/" not in path:
            if not self._require_auth():
                return

            collection_key = urllib.parse.unquote(path.rsplit("/", 1)[-1])
            if collection_key not in self.fixture.collections:
                self._write_json(404, {"message": "Collection not found"})
                return

            self.fixture.collections.pop(collection_key, None)
            if collection_key == "users":
                self.fixture.records = {}
            self._write_empty(204)
            return

        if not path.startswith("/api/collections/users/records/"):
            self._write_json(404, {"message": "Not found"})
            return

        if not self._require_auth():
            return

        record_id = path.rsplit("/", 1)[-1]
        self.fixture.records.pop(record_id, None)
        self._write_empty(204)


class FullE2ETests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.cli_bin = shutil.which("pocketbase-cli")
        if cls.cli_bin is None:
            candidate = Path(sysconfig.get_path("scripts")) / "pocketbase-cli"
            if candidate.exists():
                cls.cli_bin = str(candidate)
        if cls.cli_bin is None:
            candidate = Path(site.getuserbase()) / "bin" / "pocketbase-cli"
            if candidate.exists():
                cls.cli_bin = str(candidate)
        if cls.cli_bin is None:
            raise unittest.SkipTest("pocketbase-cli is not installed")

        cls.remote_fixture = _RemoteFixture()
        cls.remote_server = ThreadingHTTPServer(("127.0.0.1", 0), _PocketBaseRemoteHandler)
        cls.remote_server.fixture = cls.remote_fixture  # type: ignore[attr-defined]
        cls.remote_thread = threading.Thread(target=cls.remote_server.serve_forever, daemon=True)
        cls.remote_thread.start()
        host, port = cls.remote_server.server_address
        cls.remote_base_url = f"http://{host}:{port}"

    @classmethod
    def tearDownClass(cls) -> None:
        if hasattr(cls, "remote_server"):
            cls.remote_server.shutdown()
            cls.remote_server.server_close()
        if hasattr(cls, "remote_thread"):
            cls.remote_thread.join(timeout=5)

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.remote_fixture.reset()

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def run_cli(
        self,
        *args: str,
        input_text: str | None = None,
        timeout: int = 120,
    ) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env[STATE_DIR_ENV] = self._tmp.name

        return subprocess.run(
            [
                self.cli_bin,
                *args,
            ],
            capture_output=True,
            text=True,
            input=input_text,
            timeout=timeout,
            env=env,
            check=False,
        )

    @staticmethod
    def parse_last_json(stdout: str) -> dict[str, object]:
        return json.loads(stdout.strip().splitlines()[-1])

    def assert_cli_ok(
        self,
        completed: subprocess.CompletedProcess[str],
        *,
        action: str | None = None,
    ) -> dict[str, object]:
        self.assertEqual(completed.returncode, 0, msg=completed.stderr)
        payload = self.parse_last_json(completed.stdout)
        self.assertTrue(payload["ok"])
        if action is not None:
            self.assertEqual(payload["action"], action)
        return payload

    def assert_cli_fail(
        self,
        completed: subprocess.CompletedProcess[str],
        *,
        action: str | None = None,
    ) -> dict[str, object]:
        self.assertNotEqual(completed.returncode, 0, msg=completed.stderr or completed.stdout)
        payload = self.parse_last_json(completed.stdout)
        self.assertFalse(payload["ok"])
        if action is not None:
            self.assertEqual(payload["action"], action)
        return payload

    def write_tmp_json(self, name: str, payload: dict[str, object]) -> Path:
        path = Path(self._tmp.name) / name
        path.write_text(json.dumps(payload), encoding="utf-8")
        return path

    @staticmethod
    def extract_result(payload: dict[str, object]) -> object:
        if "result" in payload:
            return payload["result"]
        if "data" in payload:
            return payload["data"]
        return {}

    def run_schema_json(self, *args: str) -> subprocess.CompletedProcess[str]:
        completed = self.run_cli("--json", "schema", *args)
        if completed.returncode == 0:
            return completed
        return self.run_cli("schema", "--json", *args)

    def records_subcommand_available(self, subcommand: str) -> bool:
        completed = self.run_cli("records", "--help")
        if completed.returncode != 0:
            return False
        return subcommand in completed.stdout

    def configure_remote_base_url(self) -> subprocess.CompletedProcess[str]:
        return self.run_cli("--json", "config", "set", "base_url", self.remote_base_url)

    def login_superuser(self) -> subprocess.CompletedProcess[str]:
        return self.run_cli("--json", "auth", "login", "admin@example.com", "Secret123")

    def authenticate_superuser(self) -> dict[str, object]:
        self.assert_cli_ok(self.configure_remote_base_url(), action="config.set")
        return self.assert_cli_ok(self.login_superuser(), action="auth.login")

    def test_help(self) -> None:
        completed = self.run_cli("--help")
        self.assertEqual(completed.returncode, 0, msg=completed.stderr)
        self.assertIn("Remote-only PocketBase CLI for deployed PocketBase instances", completed.stdout)
        self.assertIn("auth", completed.stdout)
        self.assertIn("settings", completed.stdout)
        self.assertIn("logs", completed.stdout)
        self.assertIn("crons", completed.stdout)
        self.assertIn("collections", completed.stdout)
        self.assertIn("records", completed.stdout)
        self.assertIn("batch", completed.stdout)
        self.assertIn("files", completed.stdout)
        self.assertIn("backups", completed.stdout)
        self.assertNotIn("serve", completed.stdout)
        self.assertNotIn("migrate", completed.stdout)

    def test_info_json(self) -> None:
        self.assert_cli_ok(self.configure_remote_base_url(), action="config.set")
        payload = self.assert_cli_ok(self.run_cli("--json", "info"), action="info")
        self.assertIn("data", payload)
        self.assertEqual(payload["data"]["mode"], "remote")
        self.assertEqual(payload["data"]["resolved_base_url"], self.remote_base_url)
        self.assertTrue(payload["data"]["health"]["ok"])
        self.assertEqual(payload["data"]["health"]["data"]["message"], "ok")

    def test_history_json(self) -> None:
        self.assert_cli_ok(self.run_cli("--json", "info"), action="info")
        payload = self.assert_cli_ok(self.run_cli("--json", "history", "--limit", "5"), action="history")
        self.assertIn("items", payload["data"])
        self.assertGreaterEqual(len(payload["data"]["items"]), 1)

    def test_raw_health_request(self) -> None:
        self.assert_cli_ok(self.configure_remote_base_url(), action="config.set")
        payload = self.assert_cli_ok(self.run_cli("--json", "raw", "GET", "/api/health"), action="raw")
        self.assertEqual(payload["data"]["data"]["message"], "ok")

    def test_json_repl_stream_is_parseable_and_history_is_not_duplicated(self) -> None:
        completed = self.run_cli(
            "--json",
            input_text="info\nhistory\nexit\n",
        )
        self.assertEqual(completed.returncode, 0, msg=completed.stderr)

        lines = [line for line in completed.stdout.splitlines() if line.strip()]
        payloads = [json.loads(line) for line in lines]

        actions = [payload["action"] for payload in payloads]
        self.assertEqual(actions[0], "repl.start")
        self.assertIn("info", actions)
        self.assertIn("history", actions)
        self.assertEqual(actions[-1], "repl.exit")

        history_payload = next(payload for payload in payloads if payload["action"] == "history")
        self.assertEqual(history_payload["data"]["items"].count("info"), 1)

    def test_json_repl_history_redacts_secrets(self) -> None:
        self.assert_cli_ok(self.configure_remote_base_url(), action="config.set")
        completed = self.run_cli(
            "--json",
            input_text="auth login admin@example.com Secret123\nhistory\nexit\n",
        )
        self.assertEqual(completed.returncode, 0, msg=completed.stderr)

        lines = [line for line in completed.stdout.splitlines() if line.strip()]
        payloads = [json.loads(line) for line in lines]
        history_payload = next(payload for payload in payloads if payload["action"] == "history")
        items = history_payload["data"]["items"]
        self.assertIn("auth login admin@example.com ********", items)
        self.assertFalse(any("Secret123" in item for item in items))

    def test_json_repl_history_redacts_oauth2_secrets(self) -> None:
        self.assert_cli_ok(self.configure_remote_base_url(), action="config.set")
        completed = self.run_cli(
            "--json",
            input_text=(
                "records auth-oauth2 users --provider google --code oauth-code --redirect-url https://app.example.com/callback "
                "--code-verifier verifier123 --create-data '{\"name\":\"OAuth User\"}'\n"
                "history\n"
                "exit\n"
            ),
        )
        self.assertEqual(completed.returncode, 0, msg=completed.stderr)

        lines = [line for line in completed.stdout.splitlines() if line.strip()]
        payloads = [json.loads(line) for line in lines]
        history_payload = next(payload for payload in payloads if payload["action"] == "history")
        items = history_payload["data"]["items"]
        self.assertTrue(any("--code ********" in item for item in items))
        self.assertFalse(any("oauth-code" in item for item in items))
        self.assertFalse(any("verifier123" in item for item in items))

    def test_remote_requires_login(self) -> None:
        self.assert_cli_ok(self.configure_remote_base_url(), action="config.set")
        payload = self.assert_cli_fail(self.run_cli("--json", "collections", "list"), action="remote")
        self.assertIn("auth login", payload["message"])

    def test_remote_auth_session_and_collections(self) -> None:
        self.assert_cli_ok(self.configure_remote_base_url(), action="config.set")
        self.assert_cli_ok(
            self.run_cli("--json", "config", "set", "auth_collection", "_superusers"),
            action="config.set",
        )
        login_payload = self.assert_cli_ok(self.login_superuser(), action="auth.login")
        self.assertEqual(login_payload["data"]["data"]["token"], self.remote_fixture.initial_token)

        status_payload = self.assert_cli_ok(self.run_cli("--json", "auth", "status"), action="auth.status")
        self.assertTrue(status_payload["data"]["authenticated"])
        self.assertEqual(status_payload["data"]["configured_base_url"], self.remote_base_url)
        self.assertEqual(status_payload["data"]["active_base_url"], self.remote_base_url)
        self.assertEqual(status_payload["data"]["record"]["email"], "admin@example.com")

        whoami_payload = self.assert_cli_ok(self.run_cli("--json", "auth", "whoami"), action="auth.whoami")
        self.assertEqual(whoami_payload["data"]["record"]["id"], "superuser_1")

        refresh_payload = self.assert_cli_ok(self.run_cli("--json", "auth", "refresh"), action="auth.refresh")
        self.assertEqual(refresh_payload["data"]["data"]["token"], self.remote_fixture.refreshed_token)

        collection_list_payload = self.assert_cli_ok(
            self.run_cli("--json", "collections", "list"),
            action="collections.list",
        )
        self.assertEqual(collection_list_payload["data"]["data"]["items"][0]["name"], "users")

        collection_get_payload = self.assert_cli_ok(
            self.run_cli("--json", "collections", "get", "users"),
            action="collections.get",
        )
        self.assertEqual(collection_get_payload["data"]["data"]["id"], "collection_users")

    def test_hidden_remote_alias_namespace(self) -> None:
        self.authenticate_superuser()
        collection_list_payload = self.assert_cli_ok(
            self.run_cli("--json", "remote", "collections", "list"),
            action="collections.list",
        )
        self.assertEqual(collection_list_payload["data"]["data"]["items"][0]["name"], "users")

        raw_payload = self.assert_cli_ok(
            self.run_cli("--json", "remote", "raw", "GET", "/api/health"),
            action="raw",
        )
        self.assertEqual(raw_payload["data"]["status"], 200)

    def test_remote_records_crud_and_raw(self) -> None:
        self.authenticate_superuser()
        created_payload = self.assert_cli_ok(
            self.run_cli(
            "--json",
            "records",
            "create",
            "users",
            "--data",
            "{\"email\":\"new@example.com\",\"name\":\"New User\"}",
            ),
            action="records.create",
        )
        record_id = created_payload["data"]["data"]["id"]
        self.assertEqual(created_payload["data"]["data"]["email"], "new@example.com")

        listed_payload = self.assert_cli_ok(self.run_cli("--json", "records", "list", "users"), action="records.list")
        listed_ids = [item["id"] for item in listed_payload["data"]["data"]["items"]]
        self.assertIn(record_id, listed_ids)

        fetched_payload = self.assert_cli_ok(
            self.run_cli("--json", "records", "get", "users", record_id),
            action="records.get",
        )
        self.assertEqual(fetched_payload["data"]["data"]["name"], "New User")

        updated_payload = self.assert_cli_ok(
            self.run_cli(
            "--json",
            "records",
            "update",
            "users",
            record_id,
            "--data",
            "{\"name\":\"Updated User\"}",
            ),
            action="records.update",
        )
        self.assertEqual(updated_payload["data"]["data"]["name"], "Updated User")

        raw_payload = self.assert_cli_ok(self.run_cli("--json", "raw", "GET", "/api/health"), action="raw")
        self.assertEqual(raw_payload["data"]["data"]["message"], "ok")

        deleted_payload = self.assert_cli_ok(
            self.run_cli("--json", "records", "delete", "users", record_id, "--yes"),
            action="records.delete",
        )
        self.assertEqual(deleted_payload["data"]["status"], 204)

        listed_again_payload = self.assert_cli_ok(
            self.run_cli("--json", "records", "list", "users"),
            action="records.list",
        )
        listed_again_ids = [item["id"] for item in listed_again_payload["data"]["data"]["items"]]
        self.assertNotIn(record_id, listed_again_ids)

    def test_remote_records_binary_uploads(self) -> None:
        self.authenticate_superuser()

        avatar1 = Path(self._tmp.name) / "avatar1.png"
        avatar1.write_bytes(b"avatar-1")
        email = "binary@example.com"

        created_payload = self.assert_cli_ok(
            self.run_cli(
                "--json",
                "records",
                "create",
                "users",
                "--data",
                json.dumps({"email": email, "name": "Binary User"}),
                "--binary-file",
                f"avatar={avatar1}",
            ),
            action="records.create",
        )
        created_record = created_payload["data"]["data"]
        record_id = created_record["id"]
        self.assertEqual(created_record["avatar"], avatar1.name)

        avatar2 = Path(self._tmp.name) / "avatar2.webp"
        avatar2.write_bytes(b"avatar-2")
        updated_payload = self.assert_cli_ok(
            self.run_cli(
                "--json",
                "records",
                "update",
                "users",
                record_id,
                "--data",
                json.dumps({"name": "Binary Updated"}),
                "--binary-file",
                f"avatar={avatar2}",
            ),
            action="records.update",
        )
        self.assertEqual(updated_payload["data"]["data"]["name"], "Binary Updated")
        self.assertEqual(updated_payload["data"]["data"]["avatar"], avatar2.name)

        avatar3 = Path(self._tmp.name) / "avatar3.avif"
        avatar3.write_bytes(b"avatar-3")
        upsert_payload = self.assert_cli_ok(
            self.run_cli(
                "--json",
                "records",
                "upsert",
                "users",
                "--filter",
                f'email="{email}"',
                "--first",
                "--binary-file",
                f"avatar+={avatar3}",
            ),
            action="records.upsert",
        )
        upsert_result = self.extract_result(upsert_payload)
        self.assertIsInstance(upsert_result, dict)
        self.assertEqual(upsert_result.get("operation"), "update")
        upsert_data = upsert_result.get("data")
        self.assertIsInstance(upsert_data, dict)
        avatar_value = upsert_data.get("avatar")
        self.assertIsInstance(avatar_value, list)
        self.assertIn(avatar2.name, avatar_value)
        self.assertIn(avatar3.name, avatar_value)

    def test_remote_record_auth_flows_and_impersonate(self) -> None:
        self.assert_cli_ok(self.configure_remote_base_url(), action="config.set")
        auth_methods_payload = self.assert_cli_ok(
            self.run_cli("--json", "records", "auth-methods", "users"),
            action="records.auth-methods",
        )
        self.assertTrue(auth_methods_payload["data"]["data"]["password"]["enabled"])
        self.assertTrue(auth_methods_payload["data"]["data"]["oauth2"]["enabled"])
        self.assertTrue(auth_methods_payload["data"]["data"]["otp"]["enabled"])
        self.assertEqual(auth_methods_payload["data"]["data"]["oauth2"]["providers"][0]["name"], "google")

        oauth2_mfa_payload = self.assert_cli_ok(
            self.run_cli(
            "--json",
            "records",
            "auth-oauth2",
            "users",
            "--provider",
            "google",
            "--code",
            "oauth-mfa",
            "--redirect-url",
            "https://app.example.com/callback",
            ),
            action="records.auth-oauth2",
        )
        self.assertTrue(oauth2_mfa_payload["data"]["mfa_required"])
        self.assertEqual(oauth2_mfa_payload["data"]["mfaId"], self.remote_fixture.user_mfa_id)

        create_file = self.write_tmp_json("oauth-create.json", {"name": "OAuth User"})
        oauth2_auth_payload = self.assert_cli_ok(
            self.run_cli(
            "--json",
            "records",
            "auth-oauth2",
            "users",
            "--provider",
            "google",
            "--code",
            "oauth-new",
            "--redirect-url",
            "https://app.example.com/callback",
            "--code-verifier",
            "oauth-code-verifier",
            "--create-file",
            str(create_file),
            ),
            action="records.auth-oauth2",
        )
        self.assertEqual(oauth2_auth_payload["data"]["data"]["token"], self.remote_fixture.user_auth_token)
        self.assertTrue(oauth2_auth_payload["data"]["data"]["meta"]["isNew"])
        self.assertEqual(oauth2_auth_payload["data"]["data"]["record"]["name"], "OAuth User")

        mfa_payload = self.assert_cli_ok(
            self.run_cli(
            "--json",
            "records",
            "auth-password",
            "users",
            "mfa@example.com",
            "MfaPass123!",
            ),
            action="records.auth-password",
        )
        self.assertTrue(mfa_payload["data"]["mfa_required"])
        self.assertEqual(mfa_payload["data"]["mfaId"], self.remote_fixture.user_mfa_id)

        auth_password_payload = self.assert_cli_ok(
            self.run_cli(
            "--json",
            "records",
            "auth-password",
            "users",
            "test@example.com",
            "UserPass123!",
            ),
            action="records.auth-password",
        )
        self.assertEqual(auth_password_payload["data"]["data"]["token"], self.remote_fixture.user_auth_token)

        auth_status_payload = self.assert_cli_ok(self.run_cli("--json", "auth", "status"), action="auth.status")
        self.assertEqual(auth_status_payload["data"]["active_collection"], "users")
        self.assertEqual(auth_status_payload["data"]["record"]["email"], "test@example.com")

        auth_refresh_payload = self.assert_cli_ok(
            self.run_cli("--json", "records", "auth-refresh", "users"),
            action="records.auth-refresh",
        )
        self.assertEqual(auth_refresh_payload["data"]["data"]["token"], self.remote_fixture.user_refreshed_token)

        request_otp_payload = self.assert_cli_ok(
            self.run_cli("--json", "records", "request-otp", "users", "test@example.com"),
            action="records.request-otp",
        )
        self.assertEqual(request_otp_payload["data"]["data"]["otpId"], self.remote_fixture.user_otp_id)

        auth_otp_payload = self.assert_cli_ok(
            self.run_cli("--json", "records", "auth-otp", "users", self.remote_fixture.user_otp_id, "654321"),
            action="records.auth-otp",
        )
        self.assertEqual(auth_otp_payload["data"]["data"]["token"], self.remote_fixture.user_auth_token)

        request_password_reset_payload = self.assert_cli_ok(
            self.run_cli(
            "--json",
            "records",
            "request-password-reset",
            "users",
            "test@example.com",
            ),
            action="records.request-password-reset",
        )
        self.assertEqual(request_password_reset_payload["data"]["status"], 204)

        confirm_password_reset_payload = self.assert_cli_ok(
            self.run_cli(
            "--json",
            "records",
            "confirm-password-reset",
            "users",
            self.remote_fixture.user_password_reset_token,
            self.remote_fixture.user_new_password,
            self.remote_fixture.user_new_password,
            ),
            action="records.confirm-password-reset",
        )
        self.assertEqual(confirm_password_reset_payload["data"]["status"], 204)
        self.assertEqual(self.remote_fixture.user_password, self.remote_fixture.user_new_password)

        request_verification_payload = self.assert_cli_ok(
            self.run_cli(
            "--json",
            "records",
            "request-verification",
            "users",
            "test@example.com",
            ),
            action="records.request-verification",
        )
        self.assertEqual(request_verification_payload["data"]["status"], 204)

        confirm_verification_payload = self.assert_cli_ok(
            self.run_cli(
            "--json",
            "records",
            "confirm-verification",
            "users",
            self.remote_fixture.user_verification_token,
            ),
            action="records.confirm-verification",
        )
        self.assertEqual(confirm_verification_payload["data"]["status"], 204)
        self.assertTrue(self.remote_fixture.user_auth_record["verified"])

        request_email_change_payload = self.assert_cli_ok(
            self.run_cli(
            "--json",
            "records",
            "request-email-change",
            "users",
            "changed@example.com",
            ),
            action="records.request-email-change",
        )
        self.assertEqual(request_email_change_payload["data"]["status"], 204)

        confirm_email_change_payload = self.assert_cli_ok(
            self.run_cli(
            "--json",
            "records",
            "confirm-email-change",
            "users",
            self.remote_fixture.user_email_change_token,
            self.remote_fixture.user_new_password,
            ),
            action="records.confirm-email-change",
        )
        self.assertEqual(confirm_email_change_payload["data"]["status"], 204)
        self.assertEqual(self.remote_fixture.user_auth_record["email"], "changed@example.com")

        self.assert_cli_ok(self.login_superuser(), action="auth.login")
        impersonate_payload = self.assert_cli_ok(
            self.run_cli("--json", "records", "impersonate", "users", "user_auth_1"),
            action="records.impersonate",
        )
        self.assertEqual(impersonate_payload["data"]["data"]["token"], self.remote_fixture.impersonation_token)
        self.assertEqual(impersonate_payload["data"]["data"]["record"]["email"], "changed@example.com")

        impersonated_status_payload = self.assert_cli_ok(
            self.run_cli("--json", "auth", "status"),
            action="auth.status",
        )
        self.assertEqual(impersonated_status_payload["data"]["active_collection"], "users")
        self.assertEqual(impersonated_status_payload["data"]["record"]["id"], "user_auth_1")

    def test_remote_batch_run_from_file(self) -> None:
        self.authenticate_superuser()
        batch_file = self.write_tmp_json(
            "batch.json",
            {
                "requests": [
                    {
                        "method": "POST",
                        "url": "/api/collections/users/records",
                        "body": {"email": "batch1@example.com", "name": "Batch 1"},
                    },
                    {
                        "method": "PUT",
                        "url": "/api/collections/users/records",
                        "body": {"id": "seed_1", "name": "Seed Updated"},
                    },
                ]
            },
        )
        payload = self.assert_cli_ok(self.run_cli("--json", "batch", "run", "--file", str(batch_file)), action="batch.run")
        self.assertEqual(payload["data"]["status"], 200)
        self.assertEqual(len(payload["data"]["data"]), 2)
        self.assertEqual(payload["data"]["data"][0]["body"]["email"], "batch1@example.com")
        self.assertEqual(payload["data"]["data"][1]["body"]["name"], "Seed Updated")

        listed_payload = self.assert_cli_ok(self.run_cli("--json", "records", "list", "users"), action="records.list")
        names = [item["name"] for item in listed_payload["data"]["data"]["items"]]
        self.assertIn("Batch 1", names)
        self.assertIn("Seed Updated", names)

    def test_batch_run_rejects_invalid_payload_before_request(self) -> None:
        self.authenticate_superuser()
        payload = self.assert_cli_fail(
            self.run_cli("--json", "batch", "run", "--data", "{\"requests\":[{\"method\":\"GET\",\"url\":\"/api/health\"}]}"),
            action="batch.run",
        )
        self.assertIn("supported record actions", payload["message"])

    def test_remote_settings_logs_files_and_backups(self) -> None:
        self.authenticate_superuser()
        settings_get_payload = self.assert_cli_ok(self.run_cli("--json", "settings", "get"), action="settings.get")
        self.assertEqual(settings_get_payload["data"]["data"]["meta"]["appName"], "PocketBase Test")

        settings_patch_payload = self.assert_cli_ok(
            self.run_cli(
            "--json",
            "settings",
            "patch",
            "--data",
            "{\"meta\":{\"appName\":\"Updated App\"}}",
            ),
            action="settings.patch",
        )
        self.assertEqual(settings_patch_payload["data"]["data"]["meta"]["appName"], "Updated App")

        logs_list_payload = self.assert_cli_ok(
            self.run_cli("--json", "logs", "list", "--filter", "data.status>200"),
            action="logs.list",
        )
        self.assertEqual(logs_list_payload["data"]["data"]["totalItems"], 1)
        self.assertEqual(logs_list_payload["data"]["data"]["items"][0]["id"], "f2133873-44fb-9f38-bf82-c918f53b310d")

        logs_get_payload = self.assert_cli_ok(
            self.run_cli("--json", "logs", "get", "873f2133-9f38-44fb-bf82-c8f53b310d91"),
            action="logs.get",
        )
        self.assertEqual(logs_get_payload["data"]["data"]["message"], "first log")

        logs_stats_payload = self.assert_cli_ok(
            self.run_cli("--json", "logs", "stats", "--filter", "data.status>200"),
            action="logs.stats",
        )
        self.assertEqual(logs_stats_payload["data"]["data"][0]["date"], "2022-05-02 10:00:00.000Z")

        files_token_payload = self.assert_cli_ok(self.run_cli("--json", "files", "token"), action="files.token")
        self.assertEqual(files_token_payload["data"]["data"]["token"], self.remote_fixture.file_token)

        files_url_payload = self.assert_cli_ok(
            self.run_cli(
            "--json",
            "files",
            "url",
            "users",
            "seed_1",
            "avatar.png",
            "--thumb",
            "100x100",
            "--download",
            "--with-token",
            ),
            action="files.url",
        )
        self.assertIn("/api/files/users/seed_1/avatar.png", files_url_payload["data"]["url"])
        self.assertIn("thumb=100x100", files_url_payload["data"]["url"])
        self.assertIn("download=1", files_url_payload["data"]["url"])
        self.assertIn(f"token={self.remote_fixture.file_token}", files_url_payload["data"]["url"])

        backups_list_payload = self.assert_cli_ok(self.run_cli("--json", "backups", "list"), action="backups.list")
        self.assertIn("@test4.zip", backups_list_payload["data"]["data"])

        backups_create_payload = self.assert_cli_ok(
            self.run_cli("--json", "backups", "create", "--name", "snapshot.zip"),
            action="backups.create",
        )
        self.assertEqual(backups_create_payload["data"]["status"], 204)

        backups_delete_payload = self.assert_cli_ok(
            self.run_cli("--json", "backups", "delete", "@test4.zip", "--yes"),
            action="backups.delete",
        )
        self.assertEqual(backups_delete_payload["data"]["status"], 204)

        backups_list_again_payload = self.assert_cli_ok(
            self.run_cli("--json", "backups", "list"),
            action="backups.list",
        )
        self.assertIn("snapshot.zip", backups_list_again_payload["data"]["data"])
        self.assertNotIn("@test4.zip", backups_list_again_payload["data"]["data"])

    def test_remote_collections_crons_and_settings_admin_tools(self) -> None:
        self.authenticate_superuser()
        collection_file = self.write_tmp_json(
            "collection.json",
            {
                "name": "articles",
                "type": "base",
                "fields": [{"name": "title", "type": "text"}],
            },
        )

        collection_create_payload = self.assert_cli_ok(
            self.run_cli("--json", "collections", "create", "--file", str(collection_file)),
            action="collections.create",
        )
        self.assertEqual(collection_create_payload["data"]["data"]["name"], "articles")

        collection_update_payload = self.assert_cli_ok(
            self.run_cli(
            "--json",
            "collections",
            "update",
            "articles",
            "--data",
            "{\"name\":\"articles_v2\"}",
            ),
            action="collections.update",
        )
        self.assertEqual(collection_update_payload["data"]["data"]["name"], "articles_v2")

        scaffolds_payload = self.assert_cli_ok(
            self.run_cli("--json", "collections", "scaffolds"),
            action="collections.scaffolds",
        )
        self.assertIn("base", scaffolds_payload["data"]["data"])

        import_file = self.write_tmp_json(
            "import.json",
            {
                "collections": [
                    {
                        "name": "notes",
                        "type": "base",
                        "fields": [{"name": "body", "type": "text"}],
                    }
                ]
            },
        )
        collection_import_payload = self.assert_cli_ok(
            self.run_cli("--json", "collections", "import", "--file", str(import_file)),
            action="collections.import",
        )
        self.assertEqual(collection_import_payload["data"]["status"], 204)

        collection_delete_payload = self.assert_cli_ok(
            self.run_cli("--json", "collections", "delete", "notes", "--yes"),
            action="collections.delete",
        )
        self.assertEqual(collection_delete_payload["data"]["status"], 204)

        collection_truncate_payload = self.assert_cli_ok(
            self.run_cli("--json", "collections", "truncate", "users", "--yes"),
            action="collections.truncate",
        )
        self.assertEqual(collection_truncate_payload["data"]["status"], 204)

        listed_after_truncate_payload = self.assert_cli_ok(
            self.run_cli("--json", "records", "list", "users"),
            action="records.list",
        )
        self.assertEqual(listed_after_truncate_payload["data"]["data"]["items"], [])

        crons_list_payload = self.assert_cli_ok(self.run_cli("--json", "crons", "list"), action="crons.list")
        cron_ids = [item["id"] for item in crons_list_payload["data"]["data"]]
        self.assertIn("test", cron_ids)

        crons_run_payload = self.assert_cli_ok(
            self.run_cli("--json", "crons", "run", "test", "--yes"),
            action="crons.run",
        )
        self.assertEqual(crons_run_payload["data"]["status"], 204)
        self.assertEqual(self.remote_fixture.cron_runs, ["test"])

        settings_test_s3_payload = self.assert_cli_ok(
            self.run_cli("--json", "settings", "test-s3", "--data", "{\"filesystem\":\"storage\"}"),
            action="settings.test-s3",
        )
        self.assertEqual(settings_test_s3_payload["data"]["status"], 204)

        settings_test_email_payload = self.assert_cli_ok(
            self.run_cli(
            "--json",
            "settings",
            "test-email",
            "--data",
            "{\"template\":\"verification\",\"email\":\"test@example.com\"}",
            ),
            action="settings.test-email",
        )
        self.assertEqual(settings_test_email_payload["data"]["status"], 204)
        self.assertEqual(self.remote_fixture.sent_test_emails[0]["template"], "verification")

        apple_secret_file = self.write_tmp_json(
            "apple.json",
            {
                "clientId": "123",
                "teamId": "1234567890",
                "keyId": "1234567891",
                "privateKey": "-----BEGIN PRIVATE KEY-----\\nTEST\\n-----END PRIVATE KEY-----",
                "duration": 1,
            },
        )
        apple_secret_payload = self.assert_cli_ok(
            self.run_cli("--json", "settings", "apple-client-secret", "--file", str(apple_secret_file)),
            action="settings.apple-client-secret",
        )
        self.assertEqual(apple_secret_payload["data"]["data"]["secret"], self.remote_fixture.generated_apple_secret)

    def test_remote_backups_download_and_restore(self) -> None:
        self.authenticate_superuser()
        output_path = Path(self._tmp.name) / "downloaded-test1.zip"
        download_payload = self.assert_cli_ok(
            self.run_cli("--json", "backups", "download", "test1.zip", "--output", str(output_path)),
            action="backups.download",
        )
        self.assertEqual(download_payload["data"]["status"], 200)
        self.assertEqual(download_payload["data"]["size"], len(self.remote_fixture.backup_content["test1.zip"]))
        self.assertTrue(output_path.exists())
        self.assertEqual(output_path.read_bytes(), self.remote_fixture.backup_content["test1.zip"])

        restore_blocked_payload = self.assert_cli_fail(
            self.run_cli("--json", "backups", "restore", "test1.zip"),
            action="backups.restore",
        )
        self.assertIn("--yes", restore_blocked_payload["message"])

        restore_payload = self.assert_cli_ok(
            self.run_cli("--json", "backups", "restore", "test1.zip", "--yes"),
            action="backups.restore",
        )
        self.assertEqual(restore_payload["data"]["status"], 204)
        self.assertEqual(self.remote_fixture.restored_backup, "test1.zip")

    def test_remote_backups_upload(self) -> None:
        self.authenticate_superuser()
        upload_path = Path(self._tmp.name) / "uploaded.zip"
        upload_content = b"fake-zip-content"
        upload_path.write_bytes(upload_content)

        uploaded_payload = self.assert_cli_ok(
            self.run_cli("--json", "backups", "upload", str(upload_path)),
            action="backups.upload",
        )
        self.assertEqual(uploaded_payload["data"]["status"], 204)
        self.assertEqual(uploaded_payload["data"]["name"], "uploaded.zip")
        self.assertEqual(uploaded_payload["data"]["size"], len(upload_content))

        backups_list_payload = self.assert_cli_ok(
            self.run_cli("--json", "backups", "list"),
            action="backups.list",
        )
        self.assertIn("uploaded.zip", backups_list_payload["data"]["data"])
        self.assertEqual(self.remote_fixture.backup_content["uploaded.zip"], upload_content)

    def test_json_envelope_success_shape(self) -> None:
        self.assert_cli_ok(self.configure_remote_base_url(), action="config.set")
        payload = self.assert_cli_ok(self.run_cli("--json", "info"), action="info")
        self.assertIn("meta", payload)
        self.assertIn("result", payload)
        self.assertIsInstance(payload["meta"], dict)
        self.assertIn("schema_version", payload["meta"])
        self.assertIn("command", payload["meta"])
        self.assertNotIn("error", payload)

    def test_json_envelope_error_shape(self) -> None:
        self.assert_cli_ok(self.configure_remote_base_url(), action="config.set")
        payload = self.assert_cli_fail(self.run_cli("--json", "collections", "list"), action="remote")
        self.assertIn("meta", payload)
        self.assertIn("error", payload)
        self.assertIsInstance(payload["meta"], dict)
        self.assertIsInstance(payload["error"], dict)
        self.assertIn("schema_version", payload["meta"])
        self.assertIn("command", payload["meta"])
        self.assertIn("type", payload["error"])
        self.assertIn("message", payload["error"])

    def test_schema_json_discoverability(self) -> None:
        payload = self.assert_cli_ok(self.run_schema_json())
        schema_payload = self.extract_result(payload)
        self.assertIsInstance(schema_payload, dict)
        commands = schema_payload.get("commands")
        self.assertIsInstance(commands, list)

        paths = {item.get("path") for item in commands if isinstance(item, dict)}
        self.assertIn("schema", paths)
        self.assertIn("auth.login", paths)
        self.assertIn("collections.ensure", paths)
        self.assertIn("records.list", paths)
        self.assertIn("backups.restore", paths)

        command_meta = {item.get("path"): item for item in commands if isinstance(item, dict)}
        restore_meta = command_meta.get("backups.restore")
        self.assertIsInstance(restore_meta, dict)
        self.assertTrue(restore_meta.get("dangerous"))
        self.assertTrue(restore_meta.get("auth_required"))

    def test_schema_json_single_command_discoverability(self) -> None:
        payload = self.assert_cli_ok(self.run_schema_json("records", "list"))
        command_meta = self.extract_result(payload)
        self.assertIsInstance(command_meta, dict)
        self.assertEqual(command_meta.get("path"), "records.list")
        self.assertIsInstance(command_meta.get("arguments"), list)
        self.assertIsInstance(command_meta.get("options"), list)
        option_names = {item.get("name") for item in command_meta["options"] if isinstance(item, dict)}
        self.assertIn("--per-page", option_names)
        self.assertIn("--all", option_names)
        argument_names = {item.get("name") for item in command_meta["arguments"] if isinstance(item, dict)}
        self.assertIn("collection", argument_names)

    def test_schema_json_collections_ensure_discoverability(self) -> None:
        payload = self.assert_cli_ok(self.run_schema_json("collections", "ensure"))
        command_meta = self.extract_result(payload)
        self.assertIsInstance(command_meta, dict)
        self.assertEqual(command_meta.get("path"), "collections.ensure")
        option_names = {item.get("name") for item in command_meta.get("options", []) if isinstance(item, dict)}
        self.assertIn("--if-exists", option_names)
        self.assertIn("--if-missing", option_names)
        self.assertIn("--output", option_names)

    def test_auth_login_password_stdin(self) -> None:
        self.assert_cli_ok(self.configure_remote_base_url(), action="config.set")
        payload = self.assert_cli_ok(
            self.run_cli("--json", "auth", "login", "--password-stdin", "admin@example.com", input_text="Secret123\n"),
            action="auth.login",
        )
        result = self.extract_result(payload)
        auth_data = result.get("data") if isinstance(result, dict) else None
        self.assertIsInstance(auth_data, dict)
        self.assertEqual(auth_data.get("token"), self.remote_fixture.initial_token)

    def test_auth_login_interactive_prompts_for_missing_inputs(self) -> None:
        completed = self.run_cli(
            "auth",
            "login",
            input_text=f"{self.remote_base_url}\nadmin@example.com\nSecret123\n",
        )
        self.assertEqual(completed.returncode, 0, msg=completed.stderr)
        self.assertIn("PocketBase base URL", completed.stdout)
        self.assertIn("Identity (email)", completed.stdout)
        self.assertIn("Remote auth login successful", completed.stdout)
        self.assertNotIn(f"[{self.remote_base_url}]", completed.stdout)

        status_payload = self.assert_cli_ok(self.run_cli("--json", "auth", "status"), action="auth.status")
        self.assertTrue(status_payload["data"]["authenticated"])
        self.assertEqual(status_payload["data"]["active_base_url"], self.remote_base_url)

    def test_auth_login_interactive_failure_has_failed_hint(self) -> None:
        completed = self.run_cli(
            "auth",
            "login",
            input_text=f"{self.remote_base_url}\nadmin@example.com\nWrongSecret\n",
        )
        self.assertNotEqual(completed.returncode, 0, msg=completed.stdout)
        self.assertIn("Remote auth login failed", completed.stderr)
        self.assertIn(_AUTH_FAILED_MESSAGE, completed.stderr)

    def test_auth_login_interactive_invalid_base_url_is_user_friendly(self) -> None:
        completed = self.run_cli(
            "auth",
            "login",
            input_text="q\nadmin@example.com\nSecret123\n",
        )
        self.assertNotEqual(completed.returncode, 0, msg=completed.stdout)
        self.assertIn("Remote auth login failed: Invalid base URL", completed.stderr)
        self.assertNotIn("Traceback", completed.stderr)

    def test_auth_logout_interactive_cancel_and_confirm(self) -> None:
        self.authenticate_superuser()

        cancel = self.run_cli("auth", "logout", input_text="n\n")
        self.assertEqual(cancel.returncode, 0, msg=cancel.stderr)
        self.assertIn("Confirm logout?", cancel.stdout)
        self.assertIn("Remote auth logout cancelled", cancel.stdout)

        status_after_cancel = self.assert_cli_ok(self.run_cli("--json", "auth", "status"), action="auth.status")
        self.assertTrue(status_after_cancel["data"]["authenticated"])

        confirm = self.run_cli("auth", "logout", input_text="y\n")
        self.assertEqual(confirm.returncode, 0, msg=confirm.stderr)
        self.assertIn("Confirm logout?", confirm.stdout)
        self.assertIn("Remote auth logout successful", confirm.stdout)

        status_after_confirm = self.assert_cli_ok(self.run_cli("--json", "auth", "status"), action="auth.status")
        self.assertFalse(status_after_confirm["data"]["authenticated"])

    def test_auth_logout_yes_skips_prompt(self) -> None:
        self.authenticate_superuser()
        payload = self.assert_cli_ok(self.run_cli("--json", "auth", "logout", "--yes"), action="auth.logout")
        result = self.extract_result(payload)
        self.assertIsInstance(result, dict)
        self.assertFalse(result.get("authenticated"))

    def test_settings_patch_stdin_json(self) -> None:
        self.authenticate_superuser()
        payload = self.assert_cli_ok(
            self.run_cli(
                "--json",
                "settings",
                "patch",
                "--stdin-json",
                input_text='{"meta":{"appName":"Patched via stdin"}}\n',
            ),
            action="settings.patch",
        )
        result = self.extract_result(payload)
        data = result.get("data") if isinstance(result, dict) else None
        self.assertIsInstance(data, dict)
        self.assertEqual(data.get("meta", {}).get("appName"), "Patched via stdin")

    def test_batch_run_stdin_json(self) -> None:
        self.authenticate_superuser()
        payload = self.assert_cli_ok(
            self.run_cli(
                "--json",
                "batch",
                "run",
                "--stdin-json",
                input_text='{"requests":[{"method":"POST","url":"/api/collections/users/records","body":{"email":"stdin@example.com","name":"stdin"}}]}\n',
            ),
            action="batch.run",
        )
        result = self.extract_result(payload)
        self.assertIsInstance(result, dict)
        self.assertEqual(result.get("status"), 200)
        self.assertIsInstance(result.get("data"), list)
        self.assertEqual(result["data"][0]["body"]["email"], "stdin@example.com")

    def test_records_list_all_collects_all_pages(self) -> None:
        self.authenticate_superuser()
        for index in range(5):
            self.assert_cli_ok(
                self.run_cli(
                    "--json",
                    "records",
                    "create",
                    "users",
                    "--data",
                    json.dumps({"email": f"multi{index}@example.com", "name": f"Multi {index}"}),
                ),
                action="records.create",
            )

        payload = self.assert_cli_ok(
            self.run_cli("--json", "records", "list", "users", "--per-page", "2", "--all"),
            action="records.list",
        )
        result = self.extract_result(payload)
        data = result.get("data") if isinstance(result, dict) else None
        self.assertIsInstance(data, dict)
        self.assertIsInstance(data.get("items"), list)
        self.assertGreaterEqual(len(data["items"]), 6)
        self.assertEqual(data.get("totalItems"), len(data["items"]))

    def test_collections_ensure_creates_and_updates_by_name(self) -> None:
        self.authenticate_superuser()
        create_payload = self.assert_cli_ok(
            self.run_cli(
                "--json",
                "collections",
                "ensure",
                "--data",
                json.dumps(
                    {
                        "name": "articles",
                        "type": "base",
                        "fields": [{"name": "title", "type": "text"}],
                    }
                ),
            ),
            action="collections.ensure",
        )
        create_result = self.extract_result(create_payload)
        self.assertIsInstance(create_result, dict)
        self.assertEqual(create_result.get("operation"), "create")
        self.assertEqual(create_result.get("lookup_name"), "articles")
        self.assertEqual(create_result.get("data", {}).get("name"), "articles")

        update_payload = self.assert_cli_ok(
            self.run_cli(
                "--json",
                "collections",
                "ensure",
                "--stdin-json",
                input_text=json.dumps(
                    {
                        "name": "articles",
                        "type": "base",
                        "fields": [
                            {"name": "title", "type": "text"},
                            {"name": "status", "type": "select"},
                        ],
                    }
                )
                + "\n",
            ),
            action="collections.ensure",
        )
        update_result = self.extract_result(update_payload)
        self.assertIsInstance(update_result, dict)
        self.assertEqual(update_result.get("operation"), "update")
        self.assertEqual(update_result.get("matched", {}).get("name"), "articles")
        fields = update_result.get("data", {}).get("fields")
        self.assertIsInstance(fields, list)
        self.assertEqual(len(fields), 2)
        self.assertEqual(self.remote_fixture.collections["articles"]["fields"][1]["name"], "status")

    def test_collections_ensure_can_fail_on_existing_or_missing(self) -> None:
        self.authenticate_superuser()
        self.assert_cli_ok(
            self.run_cli(
                "--json",
                "collections",
                "ensure",
                "--data",
                json.dumps({"name": "articles", "type": "base", "fields": [{"name": "title", "type": "text"}]}),
            ),
            action="collections.ensure",
        )

        existing_payload = self.assert_cli_fail(
            self.run_cli(
                "--json",
                "collections",
                "ensure",
                "--data",
                json.dumps({"name": "articles", "type": "base", "fields": [{"name": "title", "type": "text"}]}),
                "--if-exists",
                "fail",
            ),
            action="collections.ensure",
        )
        self.assertIn("--if-exists fail", existing_payload["message"])

        missing_payload = self.assert_cli_fail(
            self.run_cli(
                "--json",
                "collections",
                "ensure",
                "--data",
                json.dumps({"name": "missing_articles", "type": "base", "fields": [{"name": "title", "type": "text"}]}),
                "--if-missing",
                "fail",
            ),
            action="collections.ensure",
        )
        self.assertIn("--if-missing fail", missing_payload["message"])

    def test_collections_ensure_summary_output_is_compact(self) -> None:
        self.authenticate_superuser()
        payload = self.assert_cli_ok(
            self.run_cli(
                "--json",
                "collections",
                "ensure",
                "--data",
                json.dumps(
                    {
                        "name": "articles",
                        "type": "base",
                        "fields": [
                            {"name": "title", "type": "text"},
                            {"name": "status", "type": "select"},
                        ],
                    }
                ),
                "--output",
                "summary",
            ),
            action="collections.ensure",
        )
        result = self.extract_result(payload)
        self.assertIsInstance(result, dict)
        self.assertEqual(result.get("output"), "summary")
        self.assertEqual(result.get("operation"), "create")
        self.assertEqual(result.get("field_count"), 2)
        self.assertEqual(result.get("collection", {}).get("name"), "articles")
        self.assertNotIn("data", result)
        self.assertNotIn("matched", result)
        self.assertNotIn("method", result)

    def test_records_delete_by_filter_requires_confirmation_if_available(self) -> None:
        if not self.records_subcommand_available("delete-by-filter"):
            self.skipTest("records delete-by-filter not available")

        self.authenticate_superuser()
        blocked_payload = self.assert_cli_fail(
            self.run_cli(
                "--json",
                "records",
                "delete-by-filter",
                "users",
                "--filter",
                "email='seed@example.com'",
            ),
            action="records.delete-by-filter",
        )
        self.assertIn("--yes", blocked_payload["message"])

        self.assert_cli_ok(
            self.run_cli(
                "--json",
                "records",
                "delete-by-filter",
                "users",
                "--filter",
                "email='seed@example.com'",
                "--yes",
            ),
            action="records.delete-by-filter",
        )
        listed_payload = self.assert_cli_ok(
            self.run_cli("--json", "records", "list", "users", "--filter", "email='seed@example.com'"),
            action="records.list",
        )
        result = self.extract_result(listed_payload)
        data = result.get("data") if isinstance(result, dict) else None
        self.assertIsInstance(data, dict)
        self.assertEqual(data.get("items"), [])


if __name__ == "__main__":
    unittest.main()
