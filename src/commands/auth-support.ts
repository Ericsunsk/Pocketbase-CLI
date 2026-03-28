import type { AppContext } from "../app/context";
import { saveContextState } from "../app/context";
import { emitError } from "../core/output";
import type { RemoteResult } from "../http/remote-client";

export function extractAuthPayload(
  result: RemoteResult<unknown>,
  action: string
): { token: string; record: Record<string, unknown> } {
  const payload =
    result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? (result.data as Record<string, unknown>)
      : {};

  const token = payload.token;
  const record = payload.record;

  if (typeof token !== "string" || !token.trim()) {
    throw new Error(`${action} response did not include a usable token`);
  }

  if (
    record !== undefined &&
    (record === null || typeof record !== "object" || Array.isArray(record))
  ) {
    throw new Error(`${action} response contained an invalid record payload`);
  }

  return {
    token,
    record: (record as Record<string, unknown> | undefined) ?? {}
  };
}

export async function saveRemoteAuthResult(
  context: AppContext,
  options: {
    result: RemoteResult<unknown>;
    action: string;
    baseUrl: string;
    collection: string;
  }
): Promise<void> {
  let payload: { token: string; record: Record<string, unknown> };

  try {
    payload = extractAuthPayload(options.result, options.action);
  } catch (error) {
    emitError({
      jsonOutput: context.jsonMode,
      action: options.action.replace(/ /gu, "."),
      message: error instanceof Error ? error.message : String(error),
      data: redactAuthResult(options.result)
    });
  }

  context.state.setRemoteAuth({
    baseUrl: options.baseUrl,
    token: payload.token,
    record: payload.record,
    collection: options.collection
  });
  await saveContextState(context);
}

export function redactAuthResult<TData>(
  result: RemoteResult<TData>
): RemoteResult<TData | Record<string, unknown>> {
  const payload =
    result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? { ...(result.data as Record<string, unknown>) }
      : null;

  if (payload && typeof payload.token === "string") {
    payload.token = "********";
  }

  return {
    ...result,
    data: (payload ?? result.data) as TData | Record<string, unknown>
  };
}
