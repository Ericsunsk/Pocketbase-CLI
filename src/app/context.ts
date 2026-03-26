import { SessionState, SessionStore } from "../core/session-store";

export interface AppContext {
  version: string;
  jsonMode: boolean;
  suppressHistory?: boolean;
  onStateSaved?: (() => void) | undefined;
  store: SessionStore;
  state: SessionState;
}

export async function createAppContext(): Promise<AppContext> {
  const store = new SessionStore();
  const state = await store.load();

  return {
    version: "0.1.0",
    jsonMode: process.argv.includes("--json"),
    suppressHistory: false,
    onStateSaved: undefined,
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

export function resolveBaseUrl(context: AppContext, baseUrl?: string | null): string | null {
  const resolved =
    baseUrl ??
    context.state.remoteAuth.base_url ??
    context.state.config.base_url;

  if (!resolved) {
    return null;
  }

  return String(resolved).replace(/\/+$/, "");
}

export function resolveAuthCollection(context: AppContext, collection?: string | null): string {
  return String(
    collection ??
      context.state.remoteAuth.collection ??
      context.state.config.auth_collection ??
      "_superusers"
  );
}

export function buildAuthStatusPayload(context: AppContext): Record<string, unknown> {
  const remoteAuth = context.state.remoteAuth;

  return {
    authenticated: context.state.hasRemoteAuth(),
    configured_base_url: context.state.config.base_url ?? null,
    configured_auth_collection: context.state.config.auth_collection ?? "_superusers",
    active_base_url: remoteAuth.base_url ?? null,
    active_collection: remoteAuth.collection ?? null,
    record: remoteAuth.record ?? null
  };
}
