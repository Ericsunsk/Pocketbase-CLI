import { Command } from "commander";

import {
  AppContext,
  normalizeBaseUrl,
  recordCommand,
  resolveAuthCollection,
  resolveBaseUrl
} from "../app/context";
import type { CommandDefinition } from "../contract/command-registry";
import { createOptionParameter } from "../contract/metadata";
import { emitSuccess } from "../core/output";
import { PocketBaseRemoteClient, PocketBaseRemoteError } from "../http/remote-client";

type PreflightStatus = "pass" | "fail" | "skip";

function createCheck(options: {
  name: string;
  status: PreflightStatus;
  required: boolean;
  message: string;
  hint?: string;
  data?: unknown;
}): Record<string, unknown> {
  return {
    name: options.name,
    status: options.status,
    required: options.required,
    message: options.message,
    hint: options.hint ?? null,
    data: options.data ?? null
  };
}

async function probeHealth(context: AppContext, baseUrl: string): Promise<Record<string, unknown>> {
  const client = new PocketBaseRemoteClient({
    baseUrl,
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
      status: "pass",
      message: "Health endpoint responded successfully.",
      data: {
        method: result.method,
        url: result.url,
        status: result.status,
        result: result.data
      }
    };
  } catch (error) {
    if (error instanceof PocketBaseRemoteError) {
      return {
        status: "fail",
        message: error.message,
        data: error.toJSON()
      };
    }

    throw error;
  }
}

export async function runPreflightCheck(
  context: AppContext,
  options: {
    baseUrl?: string;
    collection?: string;
    requireAuth?: boolean;
    skipHealth?: boolean;
  }
): Promise<Record<string, unknown>> {
  const resolvedBaseUrl = resolveBaseUrl(context, options.baseUrl);
  const resolvedCollection = resolveAuthCollection(context, options.collection);
  const savedAuthBaseUrl = normalizeBaseUrl(context.state.remoteAuth.base_url ?? null);
  const savedAuthCollection = String(context.state.remoteAuth.collection ?? "_superusers");
  const savedAuthPresent = context.state.hasRemoteAuth();
  const authMatchesTarget =
    savedAuthPresent &&
    savedAuthBaseUrl === resolvedBaseUrl &&
    savedAuthCollection === resolvedCollection;

  const checks: Record<string, unknown>[] = [];
  const missingPrerequisites: string[] = [];
  const recommendations: string[] = [];

  if (resolvedBaseUrl) {
    checks.push(
      createCheck({
        name: "base_url",
        status: "pass",
        required: true,
        message: "Base URL is configured.",
        data: { resolved_base_url: resolvedBaseUrl }
      })
    );
  } else {
    missingPrerequisites.push("base_url");
    recommendations.push(
      "Set `POCKETBASE_CLI_BASE_URL` in `.env`, run `config set base_url <url>`, or pass `--base-url <url>`."
    );
    checks.push(
      createCheck({
        name: "base_url",
        status: "fail",
        required: true,
        message: "Base URL is missing.",
        hint:
          "Set `POCKETBASE_CLI_BASE_URL` in `.env`, run `config set base_url <url>`, or pass `--base-url <url>`.",
        data: { resolved_base_url: null }
      })
    );
  }

  if (options.requireAuth) {
    if (authMatchesTarget) {
      checks.push(
        createCheck({
          name: "auth",
          status: "pass",
          required: true,
          message: "Saved auth matches the resolved target.",
          data: {
            base_url: savedAuthBaseUrl,
            collection: savedAuthCollection
          }
        })
      );
    } else {
      missingPrerequisites.push("auth_login");
      recommendations.push(
        "Run `auth login` again so the saved auth token matches the resolved base URL and collection."
      );
      checks.push(
        createCheck({
          name: "auth",
          status: "fail",
          required: true,
          message: savedAuthPresent
            ? "Saved auth does not match the resolved target."
            : "Saved auth token is missing.",
          hint:
            "Run `auth login` again after setting the intended `base_url` and `auth_collection`.",
          data: {
            saved_auth_present: savedAuthPresent,
            saved_auth_base_url: savedAuthBaseUrl,
            saved_auth_collection: savedAuthCollection
          }
        })
      );
    }
  } else {
    checks.push(
      createCheck({
        name: "auth",
        status: authMatchesTarget ? "pass" : "skip",
        required: false,
        message: savedAuthPresent
          ? authMatchesTarget
            ? "Saved auth is available for the resolved target."
            : "Saved auth exists but targets a different base URL or collection."
          : "Saved auth is optional for this preflight run.",
        data: {
          saved_auth_present: savedAuthPresent,
          saved_auth_matches_target: authMatchesTarget
        }
      })
    );
  }

  let health: Record<string, unknown> | null = null;
  if (options.skipHealth || !resolvedBaseUrl) {
    health = {
      status: options.skipHealth ? "skip" : "fail",
      message: options.skipHealth
        ? "Health probe skipped."
        : "Health probe skipped because base URL is missing.",
      data: null
    };
    checks.push(
      createCheck({
        name: "health",
        status: options.skipHealth ? "skip" : "fail",
        required: !options.skipHealth && Boolean(resolvedBaseUrl),
        message: health.message as string
      })
    );
  } else {
    health = await probeHealth(context, resolvedBaseUrl);
    checks.push(
      createCheck({
        name: "health",
        status: health.status as PreflightStatus,
        required: true,
        message: String(health.message),
        data: health.data
      })
    );
  }

  const ready = checks.every((check) => {
    const status = check.status as PreflightStatus;
    return check.required !== true || status === "pass";
  });

  return {
    ready,
    require_auth: Boolean(options.requireAuth),
    skipped_health: Boolean(options.skipHealth),
    resolved_base_url: resolvedBaseUrl,
    resolved_auth_collection: resolvedCollection,
    missing_prerequisites: missingPrerequisites,
    recommendations,
    saved_auth: {
      present: savedAuthPresent,
      target_match: authMatchesTarget,
      base_url: savedAuthBaseUrl,
      collection: savedAuthCollection
    },
    checks,
    health
  };
}

export function createPreflightDefinition(context: AppContext): CommandDefinition {
  return {
    name: "preflight",
    path: "preflight",
    kind: "command",
    summary: "Check whether the current CLI state is ready for the next remote command",
    authRequired: false,
    destructive: false,
    confirmationRequired: false,
    examples: [
      "pocketbase-cli --json preflight",
      "pocketbase-cli --json preflight --require-auth",
      "pocketbase-cli --json preflight --base-url https://pb.example.com --collection users --skip-health"
    ],
    notes: [
      "This command is read-only and never mutates saved config or auth state.",
      "Use `--require-auth` when the next command needs a saved auth token matched to the resolved target."
    ],
    parameters: [
      createOptionParameter({
        name: "--base-url",
        type: "TEXT",
        help: "Override the resolved PocketBase base URL for this preflight check"
      }),
      createOptionParameter({
        name: "--collection",
        type: "TEXT",
        help: "Override the resolved auth collection for this preflight check"
      }),
      createOptionParameter({
        name: "--require-auth",
        type: "BOOLEAN",
        help: "Mark saved auth as a required prerequisite",
        isFlag: true
      }),
      createOptionParameter({
        name: "--skip-health",
        type: "BOOLEAN",
        help: "Skip the `/api/health` probe and only validate local prerequisites",
        isFlag: true
      })
    ],
    build: () =>
      new Command("preflight")
        .description("Check whether the current CLI state is ready for the next remote command")
        .option("--base-url <url>", "Override the resolved PocketBase base URL for this check")
        .option("--collection <name>", "Override the resolved auth collection for this check")
        .option("--require-auth", "Require a saved auth token matched to the resolved target")
        .option("--skip-health", "Skip probing `/api/health`")
        .action(async (options: {
          baseUrl?: string;
          collection?: string;
          requireAuth?: boolean;
          skipHealth?: boolean;
        }) => {
          const historyParts = ["preflight"];
          if (options.baseUrl) {
            historyParts.push("--base-url", options.baseUrl);
          }
          if (options.collection) {
            historyParts.push("--collection", options.collection);
          }
          if (options.requireAuth) {
            historyParts.push("--require-auth");
          }
          if (options.skipHealth) {
            historyParts.push("--skip-health");
          }
          await recordCommand(context, historyParts.join(" "));
          const payload = await runPreflightCheck(context, options);

          emitSuccess({
            jsonOutput: context.jsonMode,
            action: "preflight",
            message: payload.ready ? "Preflight check passed" : "Preflight check requires attention",
            data: payload
          });
        })
  };
}
