import { Command } from "commander";

import {
  AppContext,
  recordCommand,
  resolveAuthCollection,
  resolveBaseUrl
} from "../app/context";
import type { CommandDefinition } from "../contract/command-registry";
import { emitSuccess } from "../core/output";
import { PocketBaseRemoteClient, PocketBaseRemoteError } from "../http/remote-client";
import { parseBaseUrlValue } from "../input/validators";

async function probeHealth(context: AppContext): Promise<Record<string, unknown> | null> {
  const rawResolvedBaseUrl = resolveBaseUrl(context);
  if (!rawResolvedBaseUrl) {
    return null;
  }

  let resolvedBaseUrl: string;
  try {
    resolvedBaseUrl = parseBaseUrlValue("base_url", rawResolvedBaseUrl);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      status: 0,
      url: rawResolvedBaseUrl
    };
  }

  const client = new PocketBaseRemoteClient({
    baseUrl: resolvedBaseUrl,
    token: context.state.remoteAuth.token,
    collection: resolveAuthCollection(context),
    timeout: context.state.config.timeout ?? null
  });

  try {
    const result = await client.raw({
      method: "GET",
      path: "/api/health",
      requireAuth: false
    });

    return {
      ok: true,
      status: result.status,
      data: result.data
    };
  } catch (error) {
    if (error instanceof PocketBaseRemoteError) {
      return {
        ok: false,
        message: error.message,
        status: error.status,
        url: error.url
      };
    }

    throw error;
  }
}

export function createInfoDefinition(context: AppContext): CommandDefinition {
  return {
    name: "info",
    path: "info",
    kind: "command",
    summary: "Show remote mode details, config, auth state, and health check",
    authRequired: false,
    destructive: false,
    confirmationRequired: false,
    examples: ["pocketbase-cli --json info"],
    build: () =>
      new Command("info")
        .description("Show remote mode details, config, auth state, and health check")
        .action(async () => {
          await recordCommand(context, "info");

          const remoteAuth = context.state.remoteAuth;
          const payload = {
            mode: "remote",
            active_config: context.state.config,
            env_config: {
              base_url: context.envConfig?.base_url ?? null
            },
            resolved_base_url: resolveBaseUrl(context),
            resolved_auth_collection: resolveAuthCollection(context),
            remote_auth: {
              authenticated: context.state.hasRemoteAuth(),
              base_url: remoteAuth.base_url ?? null,
              collection: remoteAuth.collection ?? null,
              record: remoteAuth.record ?? null
            },
            health: await probeHealth(context)
          };

          emitSuccess({
            jsonOutput: context.jsonMode,
            action: "info",
            message: "PocketBase remote CLI info",
            data: payload
          });
        })
  };
}
