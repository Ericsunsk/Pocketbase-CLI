import { createInterface } from "node:readline/promises";

import { Command } from "commander";

import {
  AppContext,
  buildAuthStatusPayload,
  recordCommand,
  saveContextState
} from "../app/context";
import type { CommandDefinition } from "../contract/command-registry";
import { createOptionParameter } from "../contract/metadata";
import { emitSuccess } from "../core/output";
import { PocketBaseRemoteError } from "../http/remote-client";
import { redactAuthResult, saveRemoteAuthResult } from "./auth-support";
import { createAuthLoginDefinition } from "./auth-browser";
import { buildRemoteClient, handleRemoteError } from "./support";

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
      createAuthLogoutDefinition(context),
      createAuthStatusDefinition(context),
      createAuthWhoamiDefinition(context),
      createAuthRefreshDefinition(context)
    ],
    build: () => new Command("auth").description("Manage remote PocketBase auth session")
  };
}
