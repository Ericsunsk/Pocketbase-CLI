import { Command } from "commander";

import { AppContext, clearRemoteAuthIfConfigTargetChanged, recordCommand } from "../app/context";
import type { CommandDefinition } from "../contract/command-registry";
import { emitError, emitSuccess } from "../core/output";
import { parseIntegerOptionValue } from "../input/validators";

function createUndoDefinition(context: AppContext): CommandDefinition {
  return {
    name: "undo",
    path: "undo",
    kind: "command",
    summary: "Undo the last config mutation",
    authRequired: false,
    destructive: false,
    confirmationRequired: false,
    build: () =>
      new Command("undo")
        .description("Undo the last config mutation")
        .action(async () => {
          try {
            const payload = context.state.undo();
            const authChange = clearRemoteAuthIfConfigTargetChanged(context);
            await recordCommand(context, "undo");
            emitSuccess({
              jsonOutput: context.jsonMode,
              action: "undo",
              message: authChange.auth_cleared
                ? "Undo applied and saved auth cleared"
                : "Undo applied",
              data: {
                ...payload,
                ...authChange
              }
            });
          } catch (error) {
            emitError({
              jsonOutput: context.jsonMode,
              action: "undo",
              message: error instanceof Error ? error.message : String(error)
            });
          }
        })
  };
}

function createRedoDefinition(context: AppContext): CommandDefinition {
  return {
    name: "redo",
    path: "redo",
    kind: "command",
    summary: "Redo the last undone config mutation",
    authRequired: false,
    destructive: false,
    confirmationRequired: false,
    build: () =>
      new Command("redo")
        .description("Redo the last undone config mutation")
        .action(async () => {
          try {
            const payload = context.state.redo();
            const authChange = clearRemoteAuthIfConfigTargetChanged(context);
            await recordCommand(context, "redo");
            emitSuccess({
              jsonOutput: context.jsonMode,
              action: "redo",
              message: authChange.auth_cleared
                ? "Redo applied and saved auth cleared"
                : "Redo applied",
              data: {
                ...payload,
                ...authChange
              }
            });
          } catch (error) {
            emitError({
              jsonOutput: context.jsonMode,
              action: "redo",
              message: error instanceof Error ? error.message : String(error)
            });
          }
        })
  };
}

function createHistoryDefinition(context: AppContext): CommandDefinition {
  return {
    name: "history",
    path: "history",
    kind: "command",
    summary: "Show recent command history",
    authRequired: false,
    destructive: false,
    confirmationRequired: false,
    parameters: [
      {
        kind: "option",
        name: "--limit",
        names: ["--limit"],
        required: false,
        takes_value: true,
        is_flag: false,
        nargs: 1,
        default: 20,
        type: "INTEGER"
      }
    ],
    build: () =>
      new Command("history")
        .description("Show recent command history")
        .option("--limit <n>", "Number of items to show", "20")
        .action((options: { limit?: string }) => {
          let parsedLimit: number;
          try {
            parsedLimit = parseIntegerOptionValue("--limit", options.limit ?? "20");
          } catch (error) {
            emitError({
              jsonOutput: context.jsonMode,
              action: "history",
              message: error instanceof Error ? error.message : String(error),
              errorType: "invalid_input"
            });
          }
          const limit = Math.max(parsedLimit, 1);
          const items = context.state.commandHistory.slice(-limit);

          emitSuccess({
            jsonOutput: context.jsonMode,
            action: "history",
            message: "Recent command history",
            data: { items }
          });
        })
  };
}

export function createHistoryCommandDefinitions(context: AppContext): CommandDefinition[] {
  return [
    createUndoDefinition(context),
    createRedoDefinition(context),
    createHistoryDefinition(context)
  ];
}
