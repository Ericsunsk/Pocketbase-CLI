import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AppContext } from "../../../src/app/context";
import { SessionState, SessionStore } from "../../../src/core/session-store";

const DEFAULT_BASE_URL = "https://pb.example.com";
let contextCounter = 0;

function createStorePath(basePath?: string): string {
  const suffix = `${process.pid}-${Date.now()}-${contextCounter++}`;

  if (!basePath) {
    return join(tmpdir(), `pocketbase-cli-test-session-${suffix}.json`);
  }

  return basePath.endsWith(".json")
    ? `${basePath.slice(0, -".json".length)}-${suffix}.json`
    : `${basePath}-${suffix}`;
}

export function makeContext(options?: {
  storePath?: string;
  version?: string;
  jsonMode?: boolean;
  suppressHistory?: boolean;
  baseUrl?: string | null;
  authCollectionConfig?: string;
  envBaseUrl?: string;
  authed?: boolean;
  authBaseUrl?: string;
  authCollection?: string;
  token?: string;
  record?: Record<string, unknown>;
}): AppContext {
  const state = new SessionState();
  const baseUrl = options?.baseUrl;

  if (baseUrl) {
    state.setConfig("base_url", baseUrl);
  }

  if (options?.authCollectionConfig) {
    state.setConfig("auth_collection", options.authCollectionConfig);
  }

  if (
    options?.authed ||
    options?.authBaseUrl ||
    options?.authCollection ||
    options?.token ||
    options?.record
  ) {
    const remoteAuthBaseUrl =
      options?.authBaseUrl ??
      (baseUrl ? `${baseUrl.replace(/\/+$/u, "")}/` : `${DEFAULT_BASE_URL}/`);

    state.setRemoteAuth({
      baseUrl: remoteAuthBaseUrl,
      token: options?.token ?? "token",
      collection: options?.authCollection,
      record: options?.record
    });
  }

  return {
    version: options?.version ?? "0.1.0",
    jsonMode: options?.jsonMode ?? false,
    suppressHistory: options?.suppressHistory ?? false,
    onStateSaved: undefined,
    envConfig: options?.envBaseUrl ? { base_url: options.envBaseUrl } : {},
    store: new SessionStore(createStorePath(options?.storePath)),
    state
  };
}
