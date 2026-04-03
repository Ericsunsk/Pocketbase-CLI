import { SessionState, SessionStore } from "../core/session-store";
import { CLI_VERSION } from "../core/version";
import { sanitizeRemoteValue } from "../http/remote-client";
import { readEnvConfig } from "../input/validators";

export interface EnvConfig {
  base_url?: string | null;
  base_url_error?: string | null;
}

export interface AppContext {
  version: string;
  jsonMode: boolean;
  suppressHistory?: boolean;
  onStateSaved?: (() => void) | undefined;
  envConfig?: EnvConfig;
  store: SessionStore;
  state: SessionState;
}

export async function createAppContext(): Promise<AppContext> {
  const store = new SessionStore();
  const state = await store.load();
  const envConfig = readEnvConfig();

  return {
    version: CLI_VERSION,
    jsonMode: process.argv.includes("--json"),
    suppressHistory: false,
    onStateSaved: undefined,
    envConfig,
    store,
    state
  };
}

export async function saveContextState(context: AppContext): Promise<void> {
  await context.store.save(context.state);
  context.onStateSaved?.();
}

export async function recordCommand(context: AppContext, commandLine: string): Promise<void> {
  if (!context.suppressHistory) {
    context.state.recordCommand(commandLine);
    await saveContextState(context);
  }
}

export function normalizeBaseUrl(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  return String(value).replace(/\/+$/, "");
}

export function clearRemoteAuthIfConfigTargetChanged(context: AppContext): {
  auth_cleared: boolean;
  cleared_auth?: {
    base_url: string | null;
    collection: string;
    reason_keys: string[];
  };
} {
  if (!context.state.hasRemoteAuth()) {
    return {
      auth_cleared: false
    };
  }

  const configuredBaseUrl = normalizeBaseUrl(context.state.config.base_url ?? null);
  const configuredCollection = context.state.config.auth_collection ?? null;
  const remoteAuthBaseUrl = normalizeBaseUrl(context.state.remoteAuth.base_url ?? null);
  const remoteAuthCollection = String(context.state.remoteAuth.collection ?? "_superusers");
  const reasonKeys: string[] = [];

  if (configuredBaseUrl !== null && configuredBaseUrl !== remoteAuthBaseUrl) {
    reasonKeys.push("base_url");
  }
  if (configuredCollection !== null && configuredCollection !== remoteAuthCollection) {
    reasonKeys.push("auth_collection");
  }

  if (reasonKeys.length === 0) {
    return {
      auth_cleared: false
    };
  }

  context.state.clearRemoteAuth();
  return {
    auth_cleared: true,
    cleared_auth: {
      base_url: remoteAuthBaseUrl,
      collection: remoteAuthCollection,
      reason_keys: reasonKeys
    }
  };
}

export function resolveBaseUrl(context: AppContext, baseUrl?: string | null): string | null {
  const resolved =
    baseUrl ??
    context.state.config.base_url ??
    context.envConfig?.base_url ??
    context.state.remoteAuth.base_url;

  if (!resolved) {
    return null;
  }

  return String(resolved).replace(/\/+$/, "");
}

export function resolveAuthCollection(context: AppContext, collection?: string | null): string {
  return String(
    collection ??
      context.state.config.auth_collection ??
      context.state.remoteAuth.collection ??
      "_superusers"
  );
}

export function buildAuthStatusPayload(context: AppContext): Record<string, unknown> {
  const remoteAuth = context.state.remoteAuth;

  return {
    authenticated: context.state.hasRemoteAuth(),
    configured_base_url: context.state.config.base_url ?? null,
    env_base_url: context.envConfig?.base_url ?? null,
    env_base_url_error: context.envConfig?.base_url_error ?? null,
    resolved_base_url: resolveBaseUrl(context),
    configured_auth_collection: context.state.config.auth_collection ?? "_superusers",
    active_base_url: remoteAuth.base_url ?? null,
    active_collection: remoteAuth.collection ?? null,
    record: sanitizeRemoteValue(remoteAuth.record ?? null)
  };
}
