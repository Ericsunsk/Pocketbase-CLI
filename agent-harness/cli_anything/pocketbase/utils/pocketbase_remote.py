from __future__ import annotations

import json
import mimetypes
import os
import secrets
import ssl
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_AUTH_TOKEN_MISSING_MESSAGE = "Remote auth token is missing. Run `auth login` first."


@dataclass
class RemoteResult:
    method: str
    url: str
    status: int
    data: Any

    def to_dict(self) -> dict[str, Any]:
        return {
            "method": self.method,
            "url": self.url,
            "status": self.status,
            "data": self.data,
        }


class PocketBaseRemoteError(RuntimeError):
    def __init__(
        self,
        *,
        method: str,
        url: str,
        status: int,
        message: str,
        data: Any = None,
    ) -> None:
        super().__init__(message)
        self.method = method
        self.url = url
        self.status = status
        self.data = data

    def to_dict(self) -> dict[str, Any]:
        return {
            "method": self.method,
            "url": self.url,
            "status": self.status,
            "data": self.data,
        }


class PocketBaseRemoteClient:
    def __init__(
        self,
        *,
        base_url: str,
        token: str | None = None,
        collection: str = "_superusers",
        timeout: int | None = None,
        user_agent: str = "cli-anything-pocketbase/0.1",
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.collection = collection
        self.timeout = timeout
        self.user_agent = user_agent
        self.ssl_context = self._build_ssl_context()

    def login(self, *, identity: str, password: str) -> RemoteResult:
        return self.request(
            "POST",
            self._collection_path(self.collection, "auth-with-password"),
            body={"identity": identity, "password": password},
        )

    def refresh(self) -> RemoteResult:
        return self.request(
            "POST",
            self._collection_path(self.collection, "auth-refresh"),
            require_auth=True,
        )

    @staticmethod
    def _record_query(*, fields: str | None = None, expand: str | None = None) -> dict[str, Any]:
        return {
            "fields": fields,
            "expand": expand,
        }

    @staticmethod
    def _quote_path_segment(value: str) -> str:
        return urllib.parse.quote(value, safe="")

    @classmethod
    def _collection_path(cls, collection: str, *segments: str) -> str:
        path = f"/api/collections/{cls._quote_path_segment(collection)}"
        if segments:
            path = f"{path}/{'/'.join(cls._quote_path_segment(segment) for segment in segments)}"
        return path

    @classmethod
    def _record_path(cls, collection: str, record_id: str, *segments: str) -> str:
        return cls._collection_path(collection, "records", record_id, *segments)

    def record_auth_methods(self, *, collection: str) -> RemoteResult:
        return self.request(
            "GET",
            self._collection_path(collection, "auth-methods"),
            require_auth=False,
        )

    def record_auth_password(
        self,
        *,
        collection: str,
        identity: str,
        password: str,
        identity_field: str | None = None,
        fields: str | None = None,
        expand: str | None = None,
        mfa_id: str | None = None,
    ) -> RemoteResult:
        body: dict[str, Any] = {
            "identity": identity,
            "password": password,
        }
        if identity_field:
            body["identityField"] = identity_field
        if mfa_id:
            body["mfaId"] = mfa_id

        return self.request(
            "POST",
            self._collection_path(collection, "auth-with-password"),
            body=body,
            query=self._record_query(fields=fields, expand=expand),
            require_auth=False,
            allowed_statuses={401},
        )

    def record_auth_oauth2(
        self,
        *,
        collection: str,
        provider: str,
        code: str,
        redirect_url: str,
        code_verifier: str | None = None,
        create_data: dict[str, Any] | None = None,
        fields: str | None = None,
        expand: str | None = None,
    ) -> RemoteResult:
        body: dict[str, Any] = {
            "provider": provider,
            "code": code,
            "redirectURL": redirect_url,
        }
        if code_verifier:
            body["codeVerifier"] = code_verifier
        if create_data is not None:
            body["createData"] = create_data

        return self.request(
            "POST",
            self._collection_path(collection, "auth-with-oauth2"),
            body=body,
            query=self._record_query(fields=fields, expand=expand),
            require_auth=False,
            allowed_statuses={401},
        )

    def record_auth_refresh(
        self,
        *,
        collection: str,
        fields: str | None = None,
        expand: str | None = None,
    ) -> RemoteResult:
        return self.request(
            "POST",
            self._collection_path(collection, "auth-refresh"),
            query=self._record_query(fields=fields, expand=expand),
            require_auth=True,
        )

    def record_request_otp(self, *, collection: str, email: str) -> RemoteResult:
        return self.request(
            "POST",
            self._collection_path(collection, "request-otp"),
            body={"email": email},
            require_auth=False,
        )

    def record_auth_otp(
        self,
        *,
        collection: str,
        otp_id: str,
        password: str,
        fields: str | None = None,
        expand: str | None = None,
        mfa_id: str | None = None,
    ) -> RemoteResult:
        body: dict[str, Any] = {
            "otpId": otp_id,
            "password": password,
        }
        if mfa_id:
            body["mfaId"] = mfa_id

        return self.request(
            "POST",
            self._collection_path(collection, "auth-with-otp"),
            body=body,
            query=self._record_query(fields=fields, expand=expand),
            require_auth=False,
            allowed_statuses={401},
        )

    def record_request_password_reset(self, *, collection: str, email: str) -> RemoteResult:
        return self.request(
            "POST",
            self._collection_path(collection, "request-password-reset"),
            body={"email": email},
            require_auth=False,
        )

    def record_confirm_password_reset(
        self,
        *,
        collection: str,
        token: str,
        password: str,
        password_confirm: str,
    ) -> RemoteResult:
        return self.request(
            "POST",
            self._collection_path(collection, "confirm-password-reset"),
            body={
                "token": token,
                "password": password,
                "passwordConfirm": password_confirm,
            },
            require_auth=False,
        )

    def record_request_verification(self, *, collection: str, email: str) -> RemoteResult:
        return self.request(
            "POST",
            self._collection_path(collection, "request-verification"),
            body={"email": email},
            require_auth=False,
        )

    def record_confirm_verification(self, *, collection: str, token: str) -> RemoteResult:
        return self.request(
            "POST",
            self._collection_path(collection, "confirm-verification"),
            body={"token": token},
            require_auth=False,
        )

    def record_request_email_change(self, *, collection: str, new_email: str) -> RemoteResult:
        return self.request(
            "POST",
            self._collection_path(collection, "request-email-change"),
            body={"newEmail": new_email},
            require_auth=True,
        )

    def record_confirm_email_change(
        self,
        *,
        collection: str,
        token: str,
        password: str,
    ) -> RemoteResult:
        return self.request(
            "POST",
            self._collection_path(collection, "confirm-email-change"),
            body={
                "token": token,
                "password": password,
            },
            require_auth=False,
        )

    def record_impersonate(
        self,
        *,
        collection: str,
        record_id: str,
        duration: int | None = None,
        fields: str | None = None,
        expand: str | None = None,
    ) -> RemoteResult:
        body = {"duration": duration} if duration is not None else None
        return self.request(
            "POST",
            self._collection_path(collection, "impersonate", record_id),
            body=body,
            query=self._record_query(fields=fields, expand=expand),
            require_auth=True,
        )

    def collections_list(
        self,
        *,
        page: int | None = None,
        per_page: int | None = None,
        filter_value: str | None = None,
        sort: str | None = None,
    ) -> RemoteResult:
        return self.request(
            "GET",
            "/api/collections",
            query={
                "page": page,
                "perPage": per_page,
                "filter": filter_value,
                "sort": sort,
            },
            require_auth=True,
        )

    def collections_get(self, name_or_id: str) -> RemoteResult:
        return self.request(
            "GET",
            self._collection_path(name_or_id),
            require_auth=True,
        )

    def collections_create(self, *, body: dict[str, Any]) -> RemoteResult:
        return self.request(
            "POST",
            "/api/collections",
            body=body,
            require_auth=True,
        )

    def collections_update(self, *, name_or_id: str, body: dict[str, Any]) -> RemoteResult:
        return self.request(
            "PATCH",
            self._collection_path(name_or_id),
            body=body,
            require_auth=True,
        )

    def collections_delete(self, name_or_id: str) -> RemoteResult:
        return self.request(
            "DELETE",
            self._collection_path(name_or_id),
            require_auth=True,
        )

    def collections_truncate(self, name_or_id: str) -> RemoteResult:
        return self.request(
            "DELETE",
            self._collection_path(name_or_id, "truncate"),
            require_auth=True,
        )

    def collections_import(self, *, body: dict[str, Any]) -> RemoteResult:
        return self.request(
            "PUT",
            "/api/collections/import",
            body=body,
            require_auth=True,
        )

    def collections_scaffolds(self) -> RemoteResult:
        return self.request(
            "GET",
            "/api/collections/meta/scaffolds",
            require_auth=True,
        )

    def settings_get(self) -> RemoteResult:
        return self.request(
            "GET",
            "/api/settings",
            require_auth=True,
        )

    def settings_patch(self, *, body: dict[str, Any]) -> RemoteResult:
        return self.request(
            "PATCH",
            "/api/settings",
            body=body,
            require_auth=True,
        )

    def settings_test_s3(self, *, body: dict[str, Any]) -> RemoteResult:
        return self.request(
            "POST",
            "/api/settings/test/s3",
            body=body,
            require_auth=True,
        )

    def settings_test_email(self, *, body: dict[str, Any]) -> RemoteResult:
        return self.request(
            "POST",
            "/api/settings/test/email",
            body=body,
            require_auth=True,
        )

    def settings_generate_apple_client_secret(self, *, body: dict[str, Any]) -> RemoteResult:
        return self.request(
            "POST",
            "/api/settings/apple/generate-client-secret",
            body=body,
            require_auth=True,
        )

    def logs_list(
        self,
        *,
        page: int | None = None,
        per_page: int | None = None,
        filter_value: str | None = None,
        sort: str | None = None,
    ) -> RemoteResult:
        return self.request(
            "GET",
            "/api/logs",
            query={
                "page": page,
                "perPage": per_page,
                "filter": filter_value,
                "sort": sort,
            },
            require_auth=True,
        )

    def logs_get(self, log_id: str) -> RemoteResult:
        return self.request(
            "GET",
            f"/api/logs/{self._quote_path_segment(log_id)}",
            require_auth=True,
        )

    def logs_stats(self, *, filter_value: str | None = None) -> RemoteResult:
        return self.request(
            "GET",
            "/api/logs/stats",
            query={
                "filter": filter_value,
            },
            require_auth=True,
        )

    def crons_list(self) -> RemoteResult:
        return self.request(
            "GET",
            "/api/crons",
            require_auth=True,
        )

    def crons_run(self, job_id: str) -> RemoteResult:
        return self.request(
            "POST",
            f"/api/crons/{self._quote_path_segment(job_id)}",
            require_auth=True,
        )

    def records_list(
        self,
        *,
        collection: str,
        page: int | None = None,
        per_page: int | None = None,
        filter_value: str | None = None,
        sort: str | None = None,
        fields: str | None = None,
        expand: str | None = None,
    ) -> RemoteResult:
        return self.request(
            "GET",
            self._collection_path(collection, "records"),
            query={
                "page": page,
                "perPage": per_page,
                "filter": filter_value,
                "sort": sort,
                "fields": fields,
                "expand": expand,
            },
            require_auth=True,
        )

    def records_get(
        self,
        *,
        collection: str,
        record_id: str,
        fields: str | None = None,
        expand: str | None = None,
    ) -> RemoteResult:
        return self.request(
            "GET",
            self._record_path(collection, record_id),
            query={
                "fields": fields,
                "expand": expand,
            },
            require_auth=True,
        )

    def records_create(self, *, collection: str, body: dict[str, Any]) -> RemoteResult:
        return self.request(
            "POST",
            self._collection_path(collection, "records"),
            body=body,
            require_auth=True,
        )

    def records_update(
        self,
        *,
        collection: str,
        record_id: str,
        body: dict[str, Any],
    ) -> RemoteResult:
        return self.request(
            "PATCH",
            self._record_path(collection, record_id),
            body=body,
            require_auth=True,
        )

    def records_delete(self, *, collection: str, record_id: str) -> RemoteResult:
        return self.request(
            "DELETE",
            self._record_path(collection, record_id),
            require_auth=True,
        )

    def files_token(self) -> RemoteResult:
        return self.request(
            "POST",
            "/api/files/token",
            require_auth=True,
        )

    def backups_list(self) -> RemoteResult:
        return self.request(
            "GET",
            "/api/backups",
            require_auth=True,
        )

    def backups_create(self, *, name: str | None = None) -> RemoteResult:
        body = {"name": name} if name else None
        return self.request(
            "POST",
            "/api/backups",
            body=body,
            require_auth=True,
        )

    def backups_upload(self, *, file_path: str | Path) -> RemoteResult:
        path = Path(file_path)
        data_bytes, content_type = self._build_multipart_file_body(
            field_name="file",
            file_path=path,
            default_content_type="application/zip",
        )
        return self._request_raw(
            "POST",
            "/api/backups/upload",
            data_bytes=data_bytes,
            extra_headers={"Content-Type": content_type},
            require_auth=True,
        )

    def backups_delete(self, name: str) -> RemoteResult:
        return self.request(
            "DELETE",
            f"/api/backups/{self._quote_path_segment(name)}",
            require_auth=True,
        )

    def backups_restore(self, name: str) -> RemoteResult:
        return self.request(
            "POST",
            f"/api/backups/{self._quote_path_segment(name)}/restore",
            require_auth=True,
        )

    def build_backup_url(self, *, name: str, token: str | None) -> str:
        return self._build_url(
            f"/api/backups/{self._quote_path_segment(name)}",
            {"token": token},
        )

    def backups_download(self, *, name: str, token: str) -> tuple[str, int, bytes]:
        return self.request_bytes(
            "GET",
            f"/api/backups/{self._quote_path_segment(name)}",
            query={"token": token},
            require_auth=False,
        )

    def batch_run(self, *, body: dict[str, Any]) -> RemoteResult:
        return self.request(
            "POST",
            "/api/batch",
            body=body,
            require_auth=True,
        )

    def build_file_url(
        self,
        *,
        collection: str,
        record_id: str,
        filename: str,
        thumb: str | None = None,
        download: bool = False,
        token: str | None = None,
    ) -> str:
        path = "/api/files/{collection}/{record_id}/{filename}".format(
            collection=self._quote_path_segment(collection),
            record_id=self._quote_path_segment(record_id),
            filename=self._quote_path_segment(filename),
        )
        return self._build_url(
            path,
            {
                "thumb": thumb,
                "download": 1 if download else None,
                "token": token,
            },
        )

    def raw(
        self,
        *,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        require_auth: bool = False,
    ) -> RemoteResult:
        return self.request(
            method.upper(),
            path,
            body=body,
            require_auth=require_auth,
        )

    def request_bytes(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        query: dict[str, Any] | None = None,
        require_auth: bool = False,
    ) -> tuple[str, int, bytes]:
        data_bytes, extra_headers = self._prepare_json_request(body)
        return self._execute_request_bytes(
            method,
            path,
            data_bytes=data_bytes,
            query=query,
            require_auth=require_auth,
            accept="*/*",
            extra_headers=extra_headers,
        )

    def request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        query: dict[str, Any] | None = None,
        require_auth: bool = False,
        allowed_statuses: set[int] | None = None,
    ) -> RemoteResult:
        data_bytes, extra_headers = self._prepare_json_request(body)
        url, status, raw_bytes = self._execute_request_bytes(
            method,
            path,
            data_bytes=data_bytes,
            query=query,
            require_auth=require_auth,
            accept="application/json",
            extra_headers=extra_headers,
            allowed_statuses=allowed_statuses,
        )
        payload = self._decode_json(raw_bytes.decode("utf-8"))
        return RemoteResult(
            method=method.upper(),
            url=url,
            status=status,
            data=payload,
        )

    def _request_raw(
        self,
        method: str,
        path: str,
        *,
        data_bytes: bytes | None = None,
        query: dict[str, Any] | None = None,
        require_auth: bool = False,
        extra_headers: dict[str, str] | None = None,
        allowed_statuses: set[int] | None = None,
    ) -> RemoteResult:
        url, status, raw_bytes = self._execute_request_bytes(
            method,
            path,
            data_bytes=data_bytes,
            query=query,
            require_auth=require_auth,
            accept="application/json",
            extra_headers=extra_headers,
            allowed_statuses=allowed_statuses,
        )
        payload = self._decode_json(raw_bytes.decode("utf-8", errors="replace"))
        return RemoteResult(
            method=method.upper(),
            url=url,
            status=status,
            data=payload,
        )

    @staticmethod
    def _prepare_json_request(body: dict[str, Any] | None) -> tuple[bytes | None, dict[str, str] | None]:
        if body is None:
            return None, None
        return json.dumps(body).encode("utf-8"), {"Content-Type": "application/json"}

    def _execute_request_bytes(
        self,
        method: str,
        path: str,
        *,
        data_bytes: bytes | None,
        query: dict[str, Any] | None,
        require_auth: bool,
        accept: str,
        extra_headers: dict[str, str] | None = None,
        allowed_statuses: set[int] | None = None,
    ) -> tuple[str, int, bytes]:
        self._ensure_auth_token(method=method, path=path, query=query, require_auth=require_auth)
        url = self._build_url(path, query)
        try:
            request = self._build_request(
                method,
                url=url,
                data_bytes=data_bytes,
                accept=accept,
                extra_headers=extra_headers,
            )
        except ValueError as exc:
            raise PocketBaseRemoteError(
                method=method.upper(),
                url=url,
                status=0,
                message=f"Invalid base URL: {exc}",
                data={
                    "base_url": self.base_url,
                },
            ) from exc

        try:
            with urllib.request.urlopen(
                request,
                timeout=self.timeout,
                context=self.ssl_context,
            ) as response:
                return url, response.status, response.read()
        except urllib.error.HTTPError as exc:
            raw_bytes = exc.read()
            if allowed_statuses and exc.code in allowed_statuses:
                return url, exc.code, raw_bytes
            self._raise_http_error(method=method, url=url, exc=exc, raw_bytes=raw_bytes)
        except urllib.error.URLError as exc:
            raise PocketBaseRemoteError(
                method=method.upper(),
                url=url,
                status=0,
                message=str(exc.reason),
                data={},
            ) from exc

    def _ensure_auth_token(
        self,
        *,
        method: str,
        path: str,
        query: dict[str, Any] | None,
        require_auth: bool,
    ) -> None:
        if require_auth and not self.token:
            raise PocketBaseRemoteError(
                method=method,
                url=self._build_url(path, query),
                status=401,
                message=_AUTH_TOKEN_MISSING_MESSAGE,
                data={},
            )

    def _build_request(
        self,
        method: str,
        *,
        url: str,
        data_bytes: bytes | None,
        accept: str,
        extra_headers: dict[str, str] | None = None,
    ) -> urllib.request.Request:
        headers = {
            "Accept": accept,
            "User-Agent": self.user_agent,
        }
        if self.token:
            headers["Authorization"] = self.token
        if extra_headers:
            headers.update(extra_headers)
        return urllib.request.Request(
            url=url,
            data=data_bytes,
            headers=headers,
            method=method.upper(),
        )

    def _raise_http_error(
        self,
        *,
        method: str,
        url: str,
        exc: urllib.error.HTTPError,
        raw_bytes: bytes,
    ) -> None:
        raw = raw_bytes.decode("utf-8", errors="replace")
        payload = self._decode_json(raw)
        message = self._extract_error_message(payload, raw, exc.reason)
        raise PocketBaseRemoteError(
            method=method.upper(),
            url=url,
            status=exc.code,
            message=message,
            data=payload,
        ) from exc

    @staticmethod
    def _build_multipart_file_body(
        *,
        field_name: str,
        file_path: Path,
        default_content_type: str,
    ) -> tuple[bytes, str]:
        boundary = f"----cli-anything-pocketbase-{secrets.token_hex(12)}"
        content_type = mimetypes.guess_type(file_path.name)[0] or default_content_type
        file_bytes = file_path.read_bytes()

        chunks = [
            f"--{boundary}\r\n".encode("utf-8"),
            (
                f'Content-Disposition: form-data; name="{field_name}"; filename="{file_path.name}"\r\n'
            ).encode("utf-8"),
            f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"),
            file_bytes,
            b"\r\n",
            f"--{boundary}--\r\n".encode("utf-8"),
        ]
        return b"".join(chunks), f"multipart/form-data; boundary={boundary}"

    def _build_url(self, path: str, query: dict[str, Any] | None = None) -> str:
        normalized_path = path if path.startswith("/") else f"/{path}"
        url = f"{self.base_url}{normalized_path}"
        if query:
            clean_query = {key: value for key, value in query.items() if value is not None}
            if clean_query:
                url = f"{url}?{urllib.parse.urlencode(clean_query)}"
        return url

    @staticmethod
    def _decode_json(raw: str) -> Any:
        if not raw.strip():
            return {}

        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return raw

    @staticmethod
    def _extract_error_message(payload: Any, raw: str, fallback: str) -> str:
        if isinstance(payload, dict):
            message = payload.get("message")
            if isinstance(message, str) and message.strip():
                return message
        if raw.strip():
            return raw.strip()
        return str(fallback)

    @staticmethod
    def _build_ssl_context() -> ssl.SSLContext:
        cafile = PocketBaseRemoteClient._find_ca_file()
        if cafile:
            return ssl.create_default_context(cafile=cafile)
        return ssl.create_default_context()

    @staticmethod
    def _find_ca_file() -> str | None:
        env_cafile = os.environ.get("SSL_CERT_FILE")
        if env_cafile and Path(env_cafile).exists():
            return env_cafile

        default_paths = ssl.get_default_verify_paths()
        candidates = [
            default_paths.cafile,
            default_paths.openssl_cafile,
            "/etc/ssl/cert.pem",
        ]

        for candidate in candidates:
            if candidate and Path(candidate).exists():
                return candidate

        return None
