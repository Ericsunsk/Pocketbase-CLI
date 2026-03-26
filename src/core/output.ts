import { Writable } from "node:stream";

export const SCHEMA_VERSION = "pocketbase-cli/v1";

type WriteTarget = Pick<Writable, "write">;

export interface HttpPayload {
  method: string;
  url: string;
  status: number;
}

export interface ErrorPayload {
  type: string;
  retryable: boolean;
  message: string;
  hint: string | null;
  missing_prerequisite: string | null;
  http_status: number | null;
}

export interface SuccessEnvelope {
  ok: true;
  schema_version: string;
  command: string;
  action: string;
  message: string;
  meta: Record<string, unknown>;
  data?: unknown;
  result?: unknown;
  http?: HttpPayload;
  pagination?: Record<string, unknown>;
}

export interface ErrorEnvelope {
  ok: false;
  schema_version: string;
  command: string;
  action: string;
  message: string;
  code: number;
  meta: Record<string, unknown>;
  error: ErrorPayload;
  data?: unknown;
  http?: HttpPayload;
}

export class CliExitError extends Error {
  public readonly code: number;

  public constructor(code: number, message?: string) {
    super(message ?? `Command failed with exit code ${code}`);
    this.code = code;
  }
}

function stringifyData(data: unknown): string {
  if (data === undefined || data === null) {
    return "";
  }

  if (typeof data === "string") {
    return data;
  }

  return JSON.stringify(data, null, 2);
}

function extractHttpPayload(data: unknown): HttpPayload | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const record = data as Record<string, unknown>;
  const method = record.method;
  const url = record.url;
  const status = record.status;

  if (typeof method === "string" && typeof url === "string" && typeof status === "number") {
    return { method, url, status };
  }

  return null;
}

function extractResultPayload(data: unknown): unknown {
  if (!data || typeof data !== "object") {
    return data;
  }

  const record = data as Record<string, unknown>;
  const keys = ["method", "url", "status", "data"];
  if (keys.every((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    return record.data;
  }

  return data;
}

function extractPaginationPayload(result: unknown): Record<string, unknown> | null {
  if (!result || typeof result !== "object") {
    return null;
  }

  const payload = result as Record<string, unknown>;
  const items = payload.items;
  if (!Array.isArray(items)) {
    return null;
  }

  const page = typeof payload.page === "number" ? payload.page : null;
  const perPage = typeof payload.perPage === "number" ? payload.perPage : null;
  const totalItems = typeof payload.totalItems === "number" ? payload.totalItems : null;
  const totalPages = typeof payload.totalPages === "number" ? payload.totalPages : null;
  const fetchedAll = typeof payload.fetchedAll === "boolean" ? payload.fetchedAll : false;
  const fetchedPages = typeof payload.fetchedPages === "number" ? payload.fetchedPages : null;
  const nextPage = typeof payload.nextPage === "number" ? payload.nextPage : null;
  const hasMore =
    nextPage !== null || (page !== null && totalPages !== null ? page < totalPages : false);

  return {
    page,
    per_page: perPage,
    total_items: totalItems,
    total_pages: totalPages,
    item_count: items.length,
    has_more: hasMore,
    next_page: nextPage,
    fetched_all: fetchedAll,
    fetched_pages: fetchedPages
  };
}

function inferErrorType(options: {
  code: number;
  message: string;
  httpStatus: number | null;
  missingPrerequisite: string | null;
}): string {
  const lowered = options.message.toLowerCase();

  if (options.missingPrerequisite) {
    return "missing_prerequisite";
  }
  if (lowered.startsWith("usage:")) {
    return "usage_error";
  }
  if (lowered.includes("destructive") || lowered.includes("--yes")) {
    return "confirmation_required";
  }
  if (
    lowered.includes("invalid json") ||
    lowered.includes("must include") ||
    lowered.includes("expects ") ||
    lowered.includes("requires exactly one")
  ) {
    return "invalid_input";
  }
  if (options.httpStatus === 401) {
    return "unauthorized";
  }
  if (options.httpStatus === 403) {
    return "forbidden";
  }
  if (options.httpStatus === 404) {
    return "not_found";
  }
  if (options.httpStatus !== null && options.httpStatus >= 500) {
    return "remote_http_error";
  }
  if (options.code >= 500) {
    return "remote_http_error";
  }

  return "runtime_error";
}

function inferRetryable(code: number, httpStatus: number | null): boolean {
  if (httpStatus !== null) {
    return httpStatus === 408 || httpStatus === 429 || httpStatus >= 500;
  }

  return code >= 500;
}

function buildMeta(action: string, code?: number): Record<string, unknown> {
  return code === undefined
    ? {
        schema_version: SCHEMA_VERSION,
        command: action
      }
    : {
        schema_version: SCHEMA_VERSION,
        command: action,
        exit_code: code
      };
}

function writeLine(target: WriteTarget, value: string): void {
  target.write(`${value}\n`);
}

export function buildSuccessEnvelope(options: {
  action: string;
  message: string;
  data?: unknown;
}): SuccessEnvelope {
  const http = extractHttpPayload(options.data);
  const resultPayload = extractResultPayload(options.data);
  const pagination = extractPaginationPayload(resultPayload);

  const payload: SuccessEnvelope = {
    ok: true,
    schema_version: SCHEMA_VERSION,
    command: options.action,
    action: options.action,
    message: options.message,
    meta: buildMeta(options.action)
  };

  if (options.data !== undefined) {
    payload.data = options.data;
    payload.result = options.data;
  }
  if (http) {
    payload.http = http;
  }
  if (pagination) {
    payload.pagination = pagination;
  }

  return payload;
}

export function emitSuccess(options: {
  jsonOutput: boolean;
  action: string;
  message: string;
  data?: unknown;
  stdout?: WriteTarget;
}): SuccessEnvelope {
  const payload = buildSuccessEnvelope({
    action: options.action,
    message: options.message,
    data: options.data
  });

  const stdout = options.stdout ?? process.stdout;

  if (options.jsonOutput) {
    writeLine(stdout, JSON.stringify(payload));
    return payload;
  }

  writeLine(stdout, options.message);
  const rendered = stringifyData(options.data);
  if (rendered) {
    writeLine(stdout, rendered);
  }

  return payload;
}

export function buildErrorEnvelope(options: {
  action: string;
  message: string;
  code?: number;
  data?: unknown;
  errorType?: string;
  hint?: string;
  retryable?: boolean;
  missingPrerequisite?: string;
  httpStatus?: number;
}): ErrorEnvelope {
  const code = options.code ?? 1;
  const http = extractHttpPayload(options.data);
  const resolvedHttpStatus =
    options.httpStatus ?? (http ? http.status : null);

  const payload: ErrorEnvelope = {
    ok: false,
    schema_version: SCHEMA_VERSION,
    command: options.action,
    action: options.action,
    message: options.message,
    code,
    meta: buildMeta(options.action, code),
    error: {
      type:
        options.errorType ??
        inferErrorType({
          code,
          message: options.message,
          httpStatus: resolvedHttpStatus,
          missingPrerequisite: options.missingPrerequisite ?? null
        }),
      retryable:
        options.retryable ?? inferRetryable(code, resolvedHttpStatus),
      message: options.message,
      hint: options.hint ?? null,
      missing_prerequisite: options.missingPrerequisite ?? null,
      http_status: resolvedHttpStatus
    }
  };

  if (options.data !== undefined) {
    payload.data = options.data;
  }
  if (http) {
    payload.http = http;
  }

  return payload;
}

export function emitError(options: {
  jsonOutput: boolean;
  action: string;
  message: string;
  code?: number;
  data?: unknown;
  errorType?: string;
  hint?: string;
  retryable?: boolean;
  missingPrerequisite?: string;
  httpStatus?: number;
  stderr?: WriteTarget;
}): never {
  const payload = buildErrorEnvelope(options);
  const stderr = options.stderr ?? process.stderr;

  if (options.jsonOutput) {
    writeLine(stderr, JSON.stringify(payload));
  } else {
    writeLine(stderr, options.message);
    const rendered = stringifyData(options.data);
    if (rendered) {
      writeLine(stderr, rendered);
    }
  }

  throw new CliExitError(options.code ?? 1, options.message);
}
