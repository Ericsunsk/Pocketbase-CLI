import { Command } from "commander";

import { AppContext, recordCommand } from "../app/context";
import type { CommandDefinition, CommandParameter } from "../contract/command-registry";
import { emitError } from "../core/output";
import { parseIntegerOptionValue } from "../input/validators";
import { fetchAllPages, runRemoteAction } from "./support";

function parseNumber(
  context: AppContext,
  action: string,
  optionName: string,
  value: string | undefined
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    return parseIntegerOptionValue(optionName, value);
  } catch (error) {
    emitError({
      jsonOutput: context.jsonMode,
      action,
      message: error instanceof Error ? error.message : String(error),
      errorType: "invalid_input"
    });
  }
}

function listParameters(): CommandParameter[] {
  return [
    {
      kind: "option",
      name: "--page",
      names: ["--page"],
      required: false,
      takes_value: true,
      is_flag: false,
      nargs: 1,
      type: "INTEGER"
    },
    {
      kind: "option",
      name: "--per-page",
      names: ["--per-page"],
      required: false,
      takes_value: true,
      is_flag: false,
      nargs: 1,
      type: "INTEGER"
    },
    {
      kind: "option",
      name: "--filter",
      names: ["--filter"],
      required: false,
      takes_value: true,
      is_flag: false,
      nargs: 1,
      type: "TEXT"
    },
    {
      kind: "option",
      name: "--sort",
      names: ["--sort"],
      required: false,
      takes_value: true,
      is_flag: false,
      nargs: 1,
      type: "TEXT"
    },
    {
      kind: "option",
      name: "--all",
      names: ["--all"],
      required: false,
      takes_value: false,
      is_flag: true,
      nargs: 1,
      type: "BOOLEAN"
    }
  ];
}

export function createLogsDefinition(context: AppContext): CommandDefinition {
  return {
    name: "logs",
    path: "logs",
    kind: "group",
    summary: "Remote logs endpoints",
    authRequired: true,
    destructive: false,
    confirmationRequired: false,
    children: [
      {
        name: "list",
        path: "logs.list",
        kind: "command",
        summary: "List remote logs",
        authRequired: true,
        destructive: false,
        confirmationRequired: false,
        parameters: listParameters(),
        build: () =>
          new Command("list")
            .description("List remote logs")
            .option("--page <number>", "Page number")
            .option("--per-page <number>", "Results per page")
            .option("--filter <filter>", "Filter expression")
            .option("--sort <sort>", "Sort spec")
            .option("--all", "Fetch all pages and merge them into a single result payload")
            .action(async (options: {
              page?: string;
              perPage?: string;
              filter?: string;
              sort?: string;
              all?: boolean;
            }) => {
              await recordCommand(context, "logs list");
              const page = parseNumber(context, "logs.list", "--page", options.page);
              const perPage = parseNumber(context, "logs.list", "--per-page", options.perPage);

              await runRemoteAction(context, {
                action: "logs.list",
                successMessage: "Logs list completed",
                operation: (client) =>
                  options.all
                    ? fetchAllPages({
                        action: "logs.list",
                        perPage,
                        fetchPage: (currentPage, currentPerPage) =>
                          client.logsList({
                            page: currentPage,
                            perPage: currentPerPage,
                            filterValue: options.filter,
                            sort: options.sort
                          })
                      })
                    : client.logsList({
                        page,
                        perPage,
                        filterValue: options.filter,
                        sort: options.sort
                      })
              });
            })
      },
      {
        name: "get",
        path: "logs.get",
        kind: "command",
        summary: "Get a single log entry",
        authRequired: true,
        destructive: false,
        confirmationRequired: false,
        parameters: [
          {
            kind: "argument",
            name: "log_id",
            required: true,
            nargs: 1,
            type: "TEXT"
          }
        ],
        build: () =>
          new Command("get")
            .description("Fetch a log entry")
            .argument("<log_id>")
            .action(async (logId: string) => {
              await recordCommand(context, `logs get ${logId}`);
              await runRemoteAction(context, {
                action: "logs.get",
                successMessage: "Log fetch completed",
                operation: (client) => client.logsGet(logId)
              });
            })
      },
      {
        name: "stats",
        path: "logs.stats",
        kind: "command",
        summary: "Fetch logs stats",
        authRequired: true,
        destructive: false,
        confirmationRequired: false,
        parameters: [
          {
            kind: "option",
            name: "--filter",
            names: ["--filter"],
            required: false,
            takes_value: true,
            is_flag: false,
            nargs: 1,
            type: "TEXT"
          }
        ],
        build: () =>
          new Command("stats")
            .description("Fetch logs stats")
            .option("--filter <filter>", "Filter expression")
            .action(async (options: { filter?: string }) => {
              await recordCommand(context, "logs stats");
              await runRemoteAction(context, {
                action: "logs.stats",
                successMessage: "Logs stats completed",
                operation: (client) =>
                  client.logsStats({
                    filterValue: options.filter
                  })
              });
            })
      }
    ],
    build: () => new Command("logs").description("Remote logs endpoints")
  };
}
