import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const AUTH_TOKEN_MISSING_MESSAGE = "Remote auth token is missing. Run `auth login` first.";

export interface RemoteResult<TData = unknown> {
  method: string;
  url: string;
  status: number;
  data: TData;
}

export interface RemoteBytesResult {
  method: string;
  url: string;
  status: number;
  data: Uint8Array;
}

export class PocketBaseRemoteError extends Error {
  public readonly method: string;
  public readonly url: string;
  public readonly status: number;
  public readonly data: unknown;

  public constructor(options: {
    method: string;
    url: string;
    status: number;
    message: string;
    data?: unknown;
  }) {
    super(options.message);
    this.method = options.method;
    this.url = options.url;
    this.status = options.status;
    this.data = options.data ?? {};
  }

  public toJSON(): Record<string, unknown> {
    return {
      method: this.method,
      url: this.url,
      status: this.status,
      data: this.data
    };
  }
}

type QueryValue = string | number | boolean | null | undefined;

function quotePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function coerceFormValues(value: unknown): string[] {
  if (value === null || value === undefined) {
    return [];
  }

  if (typeof value === "boolean") {
    return [value ? "true" : "false"];
  }

  if (typeof value === "string" || typeof value === "number") {
    return [String(value)];
  }

  return [JSON.stringify(value)];
}

function decodeJson(raw: string): unknown {
  if (!raw.trim()) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function extractErrorMessage(payload: unknown, raw: string, fallback: string): string {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const message = (payload as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  if (raw.trim()) {
    return raw.trim();
  }

  return fallback;
}

export class PocketBaseRemoteClient {
  public readonly baseUrl: string;
  public readonly token: string | null;
  public readonly collection: string;
  public readonly timeout: number | null;
  public readonly userAgent: string;

  public constructor(options: {
    baseUrl: string;
    token?: string | null;
    collection?: string;
    timeout?: number | null;
    userAgent?: string;
  }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token ?? null;
    this.collection = options.collection ?? "_superusers";
    this.timeout = options.timeout ?? null;
    this.userAgent = options.userAgent ?? "pocketbase-cli/0.1";
  }

  public login(options: {
    identity: string;
    password: string;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("POST", this.collectionPath(this.collection, "auth-with-password"), {
      body: {
        identity: options.identity,
        password: options.password
      }
    });
  }

  public refresh(): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("POST", this.collectionPath(this.collection, "auth-refresh"), {
      requireAuth: true
    });
  }

  public recordAuthMethods(collection: string): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("GET", this.collectionPath(collection, "auth-methods"), {
      requireAuth: false
    });
  }

  public recordAuthPassword(options: {
    collection: string;
    identity: string;
    password: string;
    identityField?: string | null;
    fields?: string | null;
    expand?: string | null;
    mfaId?: string | null;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    const body: Record<string, unknown> = {
      identity: options.identity,
      password: options.password
    };
    if (options.identityField) {
      body.identityField = options.identityField;
    }
    if (options.mfaId) {
      body.mfaId = options.mfaId;
    }

    return this.request("POST", this.collectionPath(options.collection, "auth-with-password"), {
      body,
      query: this.recordQuery(options.fields, options.expand),
      requireAuth: false,
      allowedStatuses: new Set([401])
    });
  }

  public recordAuthOauth2(options: {
    collection: string;
    provider: string;
    code: string;
    redirectUrl: string;
    codeVerifier?: string | null;
    createData?: Record<string, unknown> | null;
    fields?: string | null;
    expand?: string | null;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    const body: Record<string, unknown> = {
      provider: options.provider,
      code: options.code,
      redirectURL: options.redirectUrl
    };
    if (options.codeVerifier) {
      body.codeVerifier = options.codeVerifier;
    }
    if (options.createData !== undefined && options.createData !== null) {
      body.createData = options.createData;
    }

    return this.request("POST", this.collectionPath(options.collection, "auth-with-oauth2"), {
      body,
      query: this.recordQuery(options.fields, options.expand),
      requireAuth: false,
      allowedStatuses: new Set([401])
    });
  }

  public recordAuthRefresh(options: {
    collection: string;
    fields?: string | null;
    expand?: string | null;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("POST", this.collectionPath(options.collection, "auth-refresh"), {
      query: this.recordQuery(options.fields, options.expand),
      requireAuth: true
    });
  }

  public recordRequestOtp(options: {
    collection: string;
    email: string;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("POST", this.collectionPath(options.collection, "request-otp"), {
      body: {
        email: options.email
      },
      requireAuth: false
    });
  }

  public recordAuthOtp(options: {
    collection: string;
    otpId: string;
    password: string;
    fields?: string | null;
    expand?: string | null;
    mfaId?: string | null;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    const body: Record<string, unknown> = {
      otpId: options.otpId,
      password: options.password
    };
    if (options.mfaId) {
      body.mfaId = options.mfaId;
    }

    return this.request("POST", this.collectionPath(options.collection, "auth-with-otp"), {
      body,
      query: this.recordQuery(options.fields, options.expand),
      requireAuth: false,
      allowedStatuses: new Set([401])
    });
  }

  public recordRequestPasswordReset(options: {
    collection: string;
    email: string;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("POST", this.collectionPath(options.collection, "request-password-reset"), {
      body: {
        email: options.email
      },
      requireAuth: false
    });
  }

  public recordConfirmPasswordReset(options: {
    collection: string;
    token: string;
    password: string;
    passwordConfirm: string;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("POST", this.collectionPath(options.collection, "confirm-password-reset"), {
      body: {
        token: options.token,
        password: options.password,
        passwordConfirm: options.passwordConfirm
      },
      requireAuth: false
    });
  }

  public recordRequestVerification(options: {
    collection: string;
    email: string;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("POST", this.collectionPath(options.collection, "request-verification"), {
      body: {
        email: options.email
      },
      requireAuth: false
    });
  }

  public recordConfirmVerification(options: {
    collection: string;
    token: string;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("POST", this.collectionPath(options.collection, "confirm-verification"), {
      body: {
        token: options.token
      },
      requireAuth: false
    });
  }

  public recordRequestEmailChange(options: {
    collection: string;
    newEmail: string;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("POST", this.collectionPath(options.collection, "request-email-change"), {
      body: {
        newEmail: options.newEmail
      },
      requireAuth: true
    });
  }

  public recordConfirmEmailChange(options: {
    collection: string;
    token: string;
    password: string;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("POST", this.collectionPath(options.collection, "confirm-email-change"), {
      body: {
        token: options.token,
        password: options.password
      },
      requireAuth: false
    });
  }

  public recordImpersonate(options: {
    collection: string;
    recordId: string;
    duration?: number | null;
    fields?: string | null;
    expand?: string | null;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request(
      "POST",
      this.collectionPath(options.collection, "impersonate", options.recordId),
      {
        body: options.duration !== undefined && options.duration !== null ? { duration: options.duration } : undefined,
        query: this.recordQuery(options.fields, options.expand),
        requireAuth: true
      }
    );
  }

  public collectionsList(options?: {
    page?: number;
    perPage?: number;
    filterValue?: string | null;
    sort?: string | null;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("GET", "/api/collections", {
      query: {
        page: options?.page,
        perPage: options?.perPage,
        filter: options?.filterValue ?? undefined,
        sort: options?.sort ?? undefined
      },
      requireAuth: true
    });
  }

  public collectionsGet(nameOrId: string): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("GET", this.collectionPath(nameOrId), {
      requireAuth: true
    });
  }

  public collectionsCreate(options: {
    body: Record<string, unknown>;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("POST", "/api/collections", {
      body: options.body,
      requireAuth: true
    });
  }

  public collectionsUpdate(options: {
    nameOrId: string;
    body: Record<string, unknown>;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("PATCH", this.collectionPath(options.nameOrId), {
      body: options.body,
      requireAuth: true
    });
  }

  public collectionsDelete(nameOrId: string): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("DELETE", this.collectionPath(nameOrId), {
      requireAuth: true
    });
  }

  public collectionsTruncate(nameOrId: string): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("DELETE", this.collectionPath(nameOrId, "truncate"), {
      requireAuth: true
    });
  }

  public collectionsImport(options: {
    body: Record<string, unknown>;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("PUT", "/api/collections/import", {
      body: options.body,
      requireAuth: true
    });
  }

  public collectionsScaffolds(): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("GET", "/api/collections/meta/scaffolds", {
      requireAuth: true
    });
  }

  public settingsGet(): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("GET", "/api/settings", {
      requireAuth: true
    });
  }

  public settingsPatch(options: {
    body: Record<string, unknown>;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("PATCH", "/api/settings", {
      body: options.body,
      requireAuth: true
    });
  }

  public settingsTestS3(options: {
    body: Record<string, unknown>;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("POST", "/api/settings/test/s3", {
      body: options.body,
      requireAuth: true
    });
  }

  public settingsTestEmail(options: {
    body: Record<string, unknown>;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("POST", "/api/settings/test/email", {
      body: options.body,
      requireAuth: true
    });
  }

  public settingsGenerateAppleClientSecret(options: {
    body: Record<string, unknown>;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("POST", "/api/settings/apple/generate-client-secret", {
      body: options.body,
      requireAuth: true
    });
  }

  public logsList(options?: {
    page?: number;
    perPage?: number;
    filterValue?: string | null;
    sort?: string | null;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("GET", "/api/logs", {
      query: {
        page: options?.page,
        perPage: options?.perPage,
        filter: options?.filterValue ?? undefined,
        sort: options?.sort ?? undefined
      },
      requireAuth: true
    });
  }

  public logsGet(logId: string): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("GET", `/api/logs/${quotePathSegment(logId)}`, {
      requireAuth: true
    });
  }

  public logsStats(options?: {
    filterValue?: string | null;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("GET", "/api/logs/stats", {
      query: {
        filter: options?.filterValue ?? undefined
      },
      requireAuth: true
    });
  }

  public cronsList(): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("GET", "/api/crons", {
      requireAuth: true
    });
  }

  public cronsRun(jobId: string): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("POST", `/api/crons/${quotePathSegment(jobId)}`, {
      requireAuth: true
    });
  }

  public recordsList(options: {
    collection: string;
    page?: number;
    perPage?: number;
    filterValue?: string | null;
    sort?: string | null;
    fields?: string | null;
    expand?: string | null;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("GET", this.collectionPath(options.collection, "records"), {
      query: {
        page: options.page,
        perPage: options.perPage,
        filter: options.filterValue ?? undefined,
        sort: options.sort ?? undefined,
        ...this.recordQuery(options.fields, options.expand)
      },
      requireAuth: true
    });
  }

  public recordsGet(options: {
    collection: string;
    recordId: string;
    fields?: string | null;
    expand?: string | null;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("GET", this.recordPath(options.collection, options.recordId), {
      query: this.recordQuery(options.fields, options.expand),
      requireAuth: true
    });
  }

  public recordsCreate(options: {
    collection: string;
    body: Record<string, unknown>;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("POST", this.collectionPath(options.collection, "records"), {
      body: options.body,
      requireAuth: true
    });
  }

  public async recordsCreateWithFiles(options: {
    collection: string;
    body: Record<string, unknown>;
    fileFields: Array<{ fieldName: string; filePath: string }>;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    return this.requestMultipart("POST", this.collectionPath(options.collection, "records"), {
      body: options.body,
      fileFields: options.fileFields,
      requireAuth: true
    });
  }

  public recordsUpdate(options: {
    collection: string;
    recordId: string;
    body: Record<string, unknown>;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("PATCH", this.recordPath(options.collection, options.recordId), {
      body: options.body,
      requireAuth: true
    });
  }

  public async recordsUpdateWithFiles(options: {
    collection: string;
    recordId: string;
    body: Record<string, unknown>;
    fileFields: Array<{ fieldName: string; filePath: string }>;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    return this.requestMultipart(
      "PATCH",
      this.recordPath(options.collection, options.recordId),
      {
        body: options.body,
        fileFields: options.fileFields,
        requireAuth: true
      }
    );
  }

  public recordsDelete(options: {
    collection: string;
    recordId: string;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("DELETE", this.recordPath(options.collection, options.recordId), {
      requireAuth: true
    });
  }

  public filesToken(): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("POST", "/api/files/token", {
      requireAuth: true
    });
  }

  public batchRun(options: {
    body: Record<string, unknown>;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("POST", "/api/batch", {
      body: options.body,
      requireAuth: true
    });
  }

  public backupsList(): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("GET", "/api/backups", {
      requireAuth: true
    });
  }

  public backupsCreate(options: {
    name?: string | null;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("POST", "/api/backups", {
      body: options.name ? { name: options.name } : undefined,
      requireAuth: true
    });
  }

  public async backupsUpload(options: {
    filePath: string;
  }): Promise<RemoteResult<Record<string, unknown>>> {
    const fileBytes = await readFile(options.filePath);
    const formData = new FormData();
    formData.append("file", new Blob([fileBytes], { type: "application/zip" }), basename(options.filePath));

    return this.requestBody("POST", "/api/backups/upload", {
      body: formData,
      requireAuth: true
    });
  }

  public backupsDelete(name: string): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("DELETE", `/api/backups/${quotePathSegment(name)}`, {
      requireAuth: true
    });
  }

  public backupsRestore(name: string): Promise<RemoteResult<Record<string, unknown>>> {
    return this.request("POST", `/api/backups/${quotePathSegment(name)}/restore`, {
      requireAuth: true
    });
  }

  public backupsDownload(options: {
    name: string;
    token: string;
  }): Promise<RemoteBytesResult> {
    return this.requestBytes("GET", `/api/backups/${quotePathSegment(options.name)}`, {
      query: {
        token: options.token
      },
      requireAuth: false
    });
  }

  public buildFileUrl(options: {
    collection: string;
    recordId: string;
    filename: string;
    thumb?: string | null;
    download?: boolean;
    token?: string | null;
  }): string {
    const path = `/api/files/${quotePathSegment(options.collection)}/${quotePathSegment(
      options.recordId
    )}/${quotePathSegment(options.filename)}`;

    return this.buildUrl(path, {
      thumb: options.thumb ?? undefined,
      download: options.download ? 1 : undefined,
      token: options.token ?? undefined
    });
  }

  public buildBackupUrl(options: { name: string; token?: string | null }): string {
    return this.buildUrl(`/api/backups/${quotePathSegment(options.name)}`, {
      token: options.token ?? undefined
    });
  }

  public async raw(options: {
    method: string;
    path: string;
    body?: Record<string, unknown> | null;
    requireAuth?: boolean;
  }): Promise<RemoteResult<unknown>> {
    return this.request(options.method.toUpperCase(), options.path, {
      body: options.body ?? undefined,
      requireAuth: options.requireAuth ?? false
    });
  }

  public async request<TData = unknown>(
    method: string,
    path: string,
    options?: {
      body?: Record<string, unknown>;
      query?: Record<string, QueryValue>;
      requireAuth?: boolean;
      allowedStatuses?: Set<number>;
    }
  ): Promise<RemoteResult<TData>> {
    return this.requestBody(method, path, {
      body: options?.body === undefined ? undefined : JSON.stringify(options.body),
      query: options?.query,
      requireAuth: options?.requireAuth,
      allowedStatuses: options?.allowedStatuses,
      headers: options?.body === undefined ? undefined : { "Content-Type": "application/json" }
    });
  }

  public buildUrl(path: string, query?: Record<string, QueryValue>): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const baseUrl = `${this.baseUrl}${normalizedPath}`;

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) {
        params.set(key, String(value));
      }
    }

    const renderedQuery = params.toString();
    return renderedQuery ? `${baseUrl}?${renderedQuery}` : baseUrl;
  }

  private collectionPath(collection: string, ...segments: string[]): string {
    const base = `/api/collections/${quotePathSegment(collection)}`;
    return segments.length === 0
      ? base
      : `${base}/${segments.map(quotePathSegment).join("/")}`;
  }

  private recordPath(collection: string, recordId: string, ...segments: string[]): string {
    return this.collectionPath(collection, "records", recordId, ...segments);
  }

  private recordQuery(
    fields?: string | null,
    expand?: string | null
  ): Record<string, QueryValue> {
    return {
      fields: fields ?? undefined,
      expand: expand ?? undefined
    };
  }

  private async buildMultipartFormData(options: {
    body: Record<string, unknown>;
    fileFields: Array<{ fieldName: string; filePath: string }>;
  }): Promise<FormData> {
    const formData = new FormData();

    for (const [fieldName, value] of Object.entries(options.body)) {
      for (const renderedValue of coerceFormValues(value)) {
        formData.append(fieldName, renderedValue);
      }
    }

    for (const fileField of options.fileFields) {
      const fileBytes = await readFile(fileField.filePath);
      const blob = new Blob([fileBytes]);
      formData.append(fileField.fieldName, blob, basename(fileField.filePath));
    }

    return formData;
  }

  private async requestMultipart<TData = unknown>(
    method: string,
    path: string,
    options: {
      body: Record<string, unknown>;
      fileFields: Array<{ fieldName: string; filePath: string }>;
      query?: Record<string, QueryValue>;
      requireAuth?: boolean;
      allowedStatuses?: Set<number>;
    }
  ): Promise<RemoteResult<TData>> {
    const formData = await this.buildMultipartFormData({
      body: options.body,
      fileFields: options.fileFields
    });

    return this.requestBody(method, path, {
      body: formData,
      query: options.query,
      requireAuth: options.requireAuth,
      allowedStatuses: options.allowedStatuses
    });
  }

  private async executeRequest(
    method: string,
    path: string,
    options: {
      body?: BodyInit;
      query?: Record<string, QueryValue>;
      requireAuth: boolean;
      allowedStatuses?: Set<number>;
      accept: string;
      headers?: Record<string, string>;
    }
  ): Promise<{ url: string; status: number; responseText: string }> {
    const url = this.buildUrl(path, options.query);

    if (options.requireAuth && !this.token) {
      throw new PocketBaseRemoteError({
        method: method.toUpperCase(),
        url,
        status: 401,
        message: AUTH_TOKEN_MISSING_MESSAGE,
        data: {}
      });
    }

    const headers: Record<string, string> = {
      Accept: options.accept,
      "User-Agent": this.userAgent,
      ...(options.headers ?? {})
    };
    if (this.token) {
      headers.Authorization = this.token;
    }

    const controller = new AbortController();
    const timeoutHandle =
      this.timeout !== null
        ? setTimeout(() => controller.abort(), this.timeout * 1000)
        : null;

    try {
      const response = await fetch(url, {
        method: method.toUpperCase(),
        headers,
        body: options.body,
        signal: controller.signal
      });
      const responseText = await response.text();

      if (!response.ok && !options.allowedStatuses?.has(response.status)) {
        const payload = decodeJson(responseText);
        throw new PocketBaseRemoteError({
          method: method.toUpperCase(),
          url,
          status: response.status,
          message: extractErrorMessage(payload, responseText, response.statusText),
          data: payload
        });
      }

      return {
        url,
        status: response.status,
        responseText
      };
    } catch (error) {
      if (error instanceof PocketBaseRemoteError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new PocketBaseRemoteError({
        method: method.toUpperCase(),
        url,
        status: 0,
        message,
        data: {}
      });
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private async requestBytes(
    method: string,
    path: string,
    options?: {
      body?: BodyInit;
      query?: Record<string, QueryValue>;
      requireAuth?: boolean;
      allowedStatuses?: Set<number>;
      headers?: Record<string, string>;
    }
  ): Promise<RemoteBytesResult> {
    const url = this.buildUrl(path, options?.query);

    if (options?.requireAuth && !this.token) {
      throw new PocketBaseRemoteError({
        method: method.toUpperCase(),
        url,
        status: 401,
        message: AUTH_TOKEN_MISSING_MESSAGE,
        data: {}
      });
    }

    const headers: Record<string, string> = {
      Accept: "*/*",
      "User-Agent": this.userAgent,
      ...(options?.headers ?? {})
    };
    if (this.token) {
      headers.Authorization = this.token;
    }

    const controller = new AbortController();
    const timeoutHandle =
      this.timeout !== null
        ? setTimeout(() => controller.abort(), this.timeout * 1000)
        : null;

    try {
      const response = await fetch(url, {
        method: method.toUpperCase(),
        headers,
        body: options?.body,
        signal: controller.signal
      });

      const data = new Uint8Array(await response.arrayBuffer());

      if (!response.ok && !options?.allowedStatuses?.has(response.status)) {
        const responseText = new TextDecoder().decode(data);
        const payload = decodeJson(responseText);
        throw new PocketBaseRemoteError({
          method: method.toUpperCase(),
          url,
          status: response.status,
          message: extractErrorMessage(payload, responseText, response.statusText),
          data: payload
        });
      }

      return {
        method: method.toUpperCase(),
        url,
        status: response.status,
        data
      };
    } catch (error) {
      if (error instanceof PocketBaseRemoteError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new PocketBaseRemoteError({
        method: method.toUpperCase(),
        url,
        status: 0,
        message,
        data: {}
      });
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private async requestBody<TData = unknown>(
    method: string,
    path: string,
    options?: {
      body?: BodyInit;
      query?: Record<string, QueryValue>;
      requireAuth?: boolean;
      allowedStatuses?: Set<number>;
      headers?: Record<string, string>;
    }
  ): Promise<RemoteResult<TData>> {
    const { url, responseText, status } = await this.executeRequest(method, path, {
      body: options?.body,
      query: options?.query,
      requireAuth: options?.requireAuth ?? false,
      allowedStatuses: options?.allowedStatuses,
      accept: "application/json",
      headers: options?.headers
    });

    return {
      method: method.toUpperCase(),
      url,
      status,
      data: decodeJson(responseText) as TData
    };
  }
}
