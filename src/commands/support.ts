import type { AppContext } from "../app/context";
import { normalizeBaseUrl, resolveAuthCollection, resolveBaseUrl } from "../app/context";
import { emitError, emitSuccess } from "../core/output";
import {
  PocketBaseRemoteClient,
  PocketBaseRemoteError,
  RemoteResult,
  sanitizeRemoteResult
} from "../http/remote-client";
import { parseBaseUrlValue } from "../input/validators";

export const RECORD_BASE_URL_REQUIRED_MESSAGE =
  "Base URL is required. Run `config set base_url <url>` first or pass `--base-url`.";
export const LOGIN_BASE_URL_REQUIRED_MESSAGE =
  "Base URL is required. Pass `--base-url` or persist it with `config set base_url <url>`.";
export const FILE_TOKEN_RESPONSE_ERROR_MESSAGE =
  "File token response did not include a usable token.";

type RemoteOperation<TData = unknown> = (
  client: PocketBaseRemoteClient
) => Promise<RemoteResult<TData>>;

function timeoutValue(context: AppContext): number | null {
  return context.state.config.timeout ?? null;
}

function validateBaseUrlForAction(
  context: AppContext,
  options: {
    action: string;
    baseUrl: string;
    sourceName: string;
  }
): string {
  try {
    return parseBaseUrlValue(options.sourceName, options.baseUrl);
  } catch (error) {
    emitError({
      jsonOutput: context.jsonMode,
      action: options.action,
      message: error instanceof Error ? error.message : String(error),
      errorType: "invalid_input",
      hint:
        "Use a valid absolute http:// or https:// URL, for example https://pb.example.com or http://127.0.0.1:8090."
    });
  }
}

export function buildRemoteClient(
  context: AppContext,
  options?: {
    requireAuth?: boolean;
    baseUrl?: string | null;
    collection?: string | null;
    action?: string;
  }
): PocketBaseRemoteClient {
  const action = options?.action ?? "remote";
  const rawBaseUrl = resolveBaseUrl(context, options?.baseUrl);
  const collection = resolveAuthCollection(context, options?.collection);

  if (!rawBaseUrl) {
    emitError({
      jsonOutput: context.jsonMode,
      action,
      message:
        "Remote base URL is not configured. Run `config set base_url <url>` or use `auth login --base-url <url>` first.",
      errorType: "missing_prerequisite",
      hint:
        "Persist a base URL with `config set base_url <url>` or pass `auth login --base-url <url>`.",
      missingPrerequisite: "base_url"
    });
  }
  const baseUrl = validateBaseUrlForAction(context, {
    action,
    baseUrl: rawBaseUrl,
    sourceName: options?.baseUrl !== undefined ? "--base-url" : "base_url"
  });

  const authBaseUrl = normalizeBaseUrl(context.state.remoteAuth.base_url);
  const authCollection = String(context.state.remoteAuth.collection ?? "_superusers");
  const savedToken = context.state.remoteAuth.token ?? null;
  const tokenMatchesTarget =
    Boolean(savedToken) && authBaseUrl === baseUrl && authCollection === collection;
  const token = tokenMatchesTarget ? savedToken : null;

  if ((options?.requireAuth ?? true) && savedToken && !tokenMatchesTarget) {
    emitError({
      jsonOutput: context.jsonMode,
      action,
      message:
        "Saved auth does not match the configured base URL or auth collection. Run `auth login` again.",
      errorType: "missing_prerequisite",
      hint:
        "Re-authenticate after changing `base_url` or `auth_collection`, or clear the saved auth with `auth logout`.",
      missingPrerequisite: "auth_login"
    });
  }

  if ((options?.requireAuth ?? true) && !token) {
    emitError({
      jsonOutput: context.jsonMode,
      action,
      message: "Remote auth token is missing. Run `auth login` first.",
      errorType: "missing_prerequisite",
      hint: "Authenticate with `auth login` before invoking remote admin endpoints.",
      missingPrerequisite: "auth_login"
    });
  }

  return new PocketBaseRemoteClient({
    baseUrl,
    token,
    collection,
    timeout: timeoutValue(context)
  });
}

export function requireBaseUrl(
  context: AppContext,
  options?: {
    action?: string;
    baseUrl?: string | null;
    message?: string;
  }
): string {
  const rawBaseUrl = resolveBaseUrl(context, options?.baseUrl);
  if (!rawBaseUrl) {
    emitError({
      jsonOutput: context.jsonMode,
      action: options?.action ?? "remote",
      message: options?.message ?? RECORD_BASE_URL_REQUIRED_MESSAGE,
      errorType: "missing_prerequisite",
      hint:
        "Persist a PocketBase base URL with `config set base_url <url>` or provide it explicitly with `--base-url`.",
      missingPrerequisite: "base_url"
    });
  }

  return validateBaseUrlForAction(context, {
    action: options?.action ?? "remote",
    baseUrl: rawBaseUrl,
    sourceName: options?.baseUrl !== undefined ? "--base-url" : "base_url"
  });
}

export function emitRemoteResult(
  context: AppContext,
  options: {
    action: string;
    message: string;
    result: RemoteResult<unknown>;
  }
): void {
  emitSuccess({
    jsonOutput: context.jsonMode,
    action: options.action,
    message: options.message,
    data: sanitizeRemoteResult(options.result)
  });
}

export function handleRemoteError(
  context: AppContext,
  action: string,
  error: unknown
): never {
  if (error instanceof PocketBaseRemoteError) {
    emitError({
      jsonOutput: context.jsonMode,
      action,
      message: error.message,
      data: error.toJSON(),
      httpStatus: error.status
    });
  }

  throw error;
}

export async function runRemoteAction<TData = unknown>(
  context: AppContext,
  options: {
    action: string;
    successMessage: string;
    operation: RemoteOperation<TData>;
    requireAuth?: boolean;
    baseUrl?: string | null;
    collection?: string | null;
  }
): Promise<void> {
  const client = buildRemoteClient(context, {
    action: options.action,
    requireAuth: options.requireAuth ?? true,
    baseUrl: options.baseUrl,
    collection: options.collection
  });

  try {
    const result = await options.operation(client);
    emitRemoteResult(context, {
      action: options.action,
      message: options.successMessage,
      result
    });
  } catch (error) {
    handleRemoteError(context, options.action, error);
  }
}

export async function fetchAllPages(
  options: {
    action: string;
    perPage?: number | null;
    fetchPage: (
      page: number,
      perPage: number
    ) => Promise<RemoteResult<Record<string, unknown>>>;
  }
): Promise<RemoteResult<Record<string, unknown>>> {
  const pageSize = options.perPage ?? 200;
  let page = 1;
  let totalItems: number | null = null;
  let fetchedPages = 0;
  const allItems: unknown[] = [];
  let lastResult: RemoteResult<Record<string, unknown>> | null = null;

  let done = false;
  while (!done) {
    const result = await options.fetchPage(page, pageSize);
    const payload = result.data;
    const items = Array.isArray(payload.items) ? payload.items : null;

    if (!items) {
      throw new Error(`${options.action} expected a paginated response with an \`items\` array`);
    }

    const totalItemsValue =
      typeof payload.totalItems === "number" ? payload.totalItems : null;
    const totalPagesValue =
      typeof payload.totalPages === "number" ? payload.totalPages : null;

    lastResult = result;
    fetchedPages += 1;
    allItems.push(...items);

    if (totalItemsValue !== null) {
      totalItems = totalItemsValue;
      if (allItems.length >= totalItemsValue) {
        done = true;
      }
    }

    if (!done && totalPagesValue !== null && page >= totalPagesValue) {
      done = true;
    }

    if (!done && items.length === 0) {
      done = true;
    }

    if (!done) {
      page += 1;
    }
  }

  if (!lastResult) {
    throw new Error(`${options.action} did not return any pages`);
  }

  return {
    method: lastResult.method,
    url: lastResult.url,
    status: lastResult.status,
    data: {
      page: 1,
      perPage: allItems.length || pageSize,
      totalItems: totalItems ?? allItems.length,
      totalPages: 1,
      items: allItems,
      fetchedAll: true,
      fetchedPages,
      nextPage: null
    }
  };
}

export function requireConfirmation(
  context: AppContext,
  options: {
    action: string;
    yes: boolean;
    message: string;
    hint: string;
  }
): boolean {
  if (options.yes) {
    return true;
  }

  emitError({
    jsonOutput: context.jsonMode,
    action: options.action,
    message: options.message,
    errorType: "confirmation_required",
    hint: options.hint
  });
}

export async function resolveFileToken(
  context: AppContext,
  options: {
    action: string;
    client: PocketBaseRemoteClient;
  }
): Promise<string> {
  try {
    const result = await options.client.filesToken();
    const payload =
      result.data && typeof result.data === "object" && !Array.isArray(result.data)
        ? (result.data as Record<string, unknown>)
        : {};
    const tokenValue = payload.token;

    if (typeof tokenValue !== "string" || !tokenValue.trim()) {
      emitError({
        jsonOutput: context.jsonMode,
        action: options.action,
        message: FILE_TOKEN_RESPONSE_ERROR_MESSAGE,
        data: result
      });
    }

    return tokenValue;
  } catch (error) {
    handleRemoteError(context, options.action, error);
  }
}
