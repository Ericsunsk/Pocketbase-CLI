import { createInterface } from "node:readline/promises";

import { Command } from "commander";

import {
  AppContext,
  buildAuthStatusPayload,
  recordCommand,
  resolveAuthCollection,
  saveContextState
} from "../app/context";
import type { CommandDefinition } from "../contract/command-registry";
import { createArgumentParameter, createOptionParameter } from "../contract/metadata";
import { emitError, emitSuccess } from "../core/output";
import { PocketBaseRemoteClient, PocketBaseRemoteError } from "../http/remote-client";
import { readSecretFromStdin } from "../input/json-input";
import { redactAuthResult, saveRemoteAuthResult } from "./auth-support";
import { runPreflightCheck } from "./preflight";
import { createAuthLoginBrowserDefinition } from "./auth-browser";
import { LOGIN_BASE_URL_REQUIRED_MESSAGE, buildRemoteClient, handleRemoteError, requireBaseUrl } from "./support";

function redactCommand(parts: string[], sensitiveIndexes?: Set<number>): string {
  if (!sensitiveIndexes || sensitiveIndexes.size === 0) {
    return parts.join(" ");
  }

  return parts
    .map((part, index) => (sensitiveIndexes.has(index) ? "********" : part))
    .join(" ");
}

async function confirmLogout(): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const answer = (await rl.question("Confirm logout? ")).trim().toLowerCase();
    if (!answer) {
      return true;
    }
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

function createAuthLoginDefinition(context: AppContext): CommandDefinition {
  return {
    name: "login",
    path: "auth.login",
    kind: "command",
    summary: "Authenticate against a remote PocketBase instance",
    authRequired: false,
    destructive: false,
    confirmationRequired: false,
    examples: [
      "printf 'Secret123\\n' | pocketbase-cli --json auth login --password-stdin admin@example.com"
    ],
    notes: [
      "Use `--password-stdin` for automation-safe secret handling instead of passing the password on argv."
    ],
    parameters: [
      createOptionParameter({
        name: "--base-url",
        type: "TEXT",
        help: "PocketBase base URL, for example `https://pb.example.com`"
      }),
      createOptionParameter({
        name: "--collection",
        type: "TEXT",
        help: "Auth collection name, defaults to `config auth_collection` or `_superusers`"
      }),
      createOptionParameter({
        name: "--password-stdin",
        type: "BOOLEAN",
        help: "Read the password from stdin instead of argv",
        isFlag: true
      }),
      createArgumentParameter({
        name: "identity",
        help: "Identity value such as an email address or username",
        required: false
      }),
      createArgumentParameter({
        name: "password",
        help: "Password value when not using `--password-stdin`",
        required: false,
        sensitive: true
      })
    ],
    build: () =>
      new Command("login")
        .description("Authenticate against a remote PocketBase instance")
        .option("--base-url <url>", "PocketBase base URL, for example https://pb.example.com")
        .option(
          "--collection <name>",
          "Auth collection to use, defaults to config auth_collection or _superusers"
        )
        .option("--password-stdin", "Read the password from stdin instead of argv")
        .argument("[identity]")
        .argument("[password]")
        .action(
          async (
            identity: string | undefined,
            password: string | undefined,
            options: {
              baseUrl?: string;
              collection?: string;
              passwordStdin?: boolean;
            }
          ) => {
            const baseUrl = requireBaseUrl(context, {
              action: "auth.login",
              baseUrl: options.baseUrl,
              message: LOGIN_BASE_URL_REQUIRED_MESSAGE
            });

            const trimmedIdentity = identity?.trim() || undefined;
            if (!trimmedIdentity) {
              emitError({
                jsonOutput: context.jsonMode,
                action: "auth.login",
                message: "auth login requires an identity (for example admin@example.com).",
                errorType: "invalid_input",
                hint:
                  "Use `auth login <identity> --password-stdin` or pass the password as the second argument."
              });
            }

            let resolvedPassword = password ?? undefined;
            if (options.passwordStdin) {
              if (password !== undefined) {
                emitError({
                  jsonOutput: context.jsonMode,
                  action: "auth.login",
                  message: "Use either a positional password or `--password-stdin`, not both.",
                  errorType: "invalid_input"
                });
              }

              try {
                resolvedPassword = await readSecretFromStdin("auth.login");
              } catch (error) {
                emitError({
                  jsonOutput: context.jsonMode,
                  action: "auth.login",
                  message: error instanceof Error ? error.message : String(error),
                  errorType: "invalid_input"
                });
              }
            } else if (resolvedPassword === undefined) {
              emitError({
                jsonOutput: context.jsonMode,
                action: "auth.login",
                message: "auth login requires a password argument or `--password-stdin`.",
                errorType: "invalid_input",
                hint:
                  "Use `auth login <identity> --password-stdin` or pass the password as the second argument."
              });
            }

            const resolvedCollection = options.collection ?? resolveAuthCollection(context);

            const historyParts = ["auth", "login"];
            if (options.baseUrl) {
              historyParts.push("--base-url", options.baseUrl);
            }
            if (options.collection) {
              historyParts.push("--collection", options.collection);
            }
            if (options.passwordStdin) {
              historyParts.push(trimmedIdentity, resolvedPassword);
            } else {
              historyParts.push(trimmedIdentity, resolvedPassword);
            }
            await recordCommand(
              context,
              redactCommand(
                historyParts,
                new Set([historyParts.length - 1])
              )
            );

            const client = new PocketBaseRemoteClient({
              baseUrl,
              collection: resolvedCollection,
              timeout: context.state.config.timeout ?? null
            });

            try {
              const result = await client.login({
                identity: trimmedIdentity,
                password: resolvedPassword
              });

              await saveRemoteAuthResult(context, {
                result,
                action: "auth login",
                baseUrl,
                collection: resolvedCollection
              });

              emitSuccess({
                jsonOutput: context.jsonMode,
                action: "auth.login",
                message: "Remote auth login successful",
                data: {
                  auth: redactAuthResult(result),
                  preflight: await runPreflightCheck(context, {
                    requireAuth: true
                  })
                }
              });
            } catch (error) {
              if (error instanceof PocketBaseRemoteError) {
                handleRemoteError(context, "auth.login", error);
              }
              throw error;
            }
          }
        )
  };
}

function createAuthLogoutDefinition(context: AppContext): CommandDefinition {
  return {
    name: "logout",
    path: "auth.logout",
    kind: "command",
    summary: "Clear saved remote auth state",
    authRequired: false,
    destructive: false,
    confirmationRequired: false,
    examples: ["pocketbase-cli --json auth logout --yes"],
    notes: ["In JSON mode (`--json`), `--yes` is required to skip the interactive confirmation prompt."],
    parameters: [
      createOptionParameter({
        name: "--yes",
        type: "BOOLEAN",
        help: "Skip interactive logout confirmation",
        isFlag: true
      })
    ],
    build: () =>
      new Command("logout")
        .description("Clear saved remote auth state")
        .option("--yes", "Skip interactive logout confirmation")
        .action(async (options: { yes?: boolean }) => {
          if (!options.yes && !context.jsonMode) {
            const confirmed = await confirmLogout();
            if (!confirmed) {
              emitSuccess({
                jsonOutput: context.jsonMode,
                action: "auth.logout",
                message: "Remote auth logout cancelled",
                data: {
                  authenticated: context.state.hasRemoteAuth(),
                  cancelled: true
                }
              });
              return;
            }
          }

          const historyParts = ["auth", "logout"];
          if (options.yes) {
            historyParts.push("--yes");
          }
          await recordCommand(context, historyParts.join(" "));

          context.state.clearRemoteAuth();
          await saveContextState(context);

          emitSuccess({
            jsonOutput: context.jsonMode,
            action: "auth.logout",
            message: "Remote auth logout successful",
            data: {
              authenticated: false
            }
          });
        })
  };
}

function createAuthStatusDefinition(context: AppContext): CommandDefinition {
  return {
    name: "status",
    path: "auth.status",
    kind: "command",
    summary: "Show remote auth status",
    authRequired: false,
    destructive: false,
    confirmationRequired: false,
    examples: ["pocketbase-cli --json auth status"],
    build: () =>
      new Command("status")
        .description("Show remote auth status")
        .action(async () => {
          await recordCommand(context, "auth status");
          emitSuccess({
            jsonOutput: context.jsonMode,
            action: "auth.status",
            message: "Remote auth status",
            data: buildAuthStatusPayload(context)
          });
        })
  };
}

function createAuthWhoamiDefinition(context: AppContext): CommandDefinition {
  return {
    name: "whoami",
    path: "auth.whoami",
    kind: "command",
    summary: "Show current remote auth identity",
    authRequired: false,
    destructive: false,
    confirmationRequired: false,
    examples: ["pocketbase-cli --json auth whoami"],
    build: () =>
      new Command("whoami")
        .description("Show current remote auth identity")
        .action(async () => {
          await recordCommand(context, "auth whoami");
          emitSuccess({
            jsonOutput: context.jsonMode,
            action: "auth.whoami",
            message: "Current remote auth identity",
            data: buildAuthStatusPayload(context)
          });
        })
  };
}

function createAuthRefreshDefinition(context: AppContext): CommandDefinition {
  return {
    name: "refresh",
    path: "auth.refresh",
    kind: "command",
    summary: "Refresh current remote auth token",
    authRequired: true,
    destructive: false,
    confirmationRequired: false,
    examples: ["pocketbase-cli --json auth refresh"],
    build: () =>
      new Command("refresh")
        .description("Refresh current remote auth token")
        .action(async () => {
          await recordCommand(context, "auth refresh");

          const client = buildRemoteClient(context, {
            action: "auth.refresh",
            requireAuth: true
          });

          try {
            const result = await client.refresh();
            await saveRemoteAuthResult(context, {
              result,
              action: "auth refresh",
              baseUrl: client.baseUrl,
              collection: client.collection
            });

            emitSuccess({
              jsonOutput: context.jsonMode,
              action: "auth.refresh",
              message: "Remote auth refreshed",
              data: {
                auth: redactAuthResult(result)
              }
            });
          } catch (error) {
            if (error instanceof PocketBaseRemoteError) {
              handleRemoteError(context, "auth.refresh", error);
            }
            throw error;
          }
        })
  };
}

export function createAuthDefinition(context: AppContext): CommandDefinition {
  return {
    name: "auth",
    path: "auth",
    kind: "group",
    summary: "Manage remote PocketBase auth session",
    authRequired: "varies",
    destructive: false,
    confirmationRequired: false,
    children: [
      createAuthLoginDefinition(context),
      createAuthLoginBrowserDefinition(context),
      createAuthLogoutDefinition(context),
      createAuthStatusDefinition(context),
      createAuthWhoamiDefinition(context),
      createAuthRefreshDefinition(context)
    ],
    build: () => new Command("auth").description("Manage remote PocketBase auth session")
  };
}
