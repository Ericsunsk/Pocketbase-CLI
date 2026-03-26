import { Command } from "commander";

import { AppContext, recordCommand } from "../app/context";
import type { CommandDefinition } from "../contract/command-registry";
import { emitError, emitSuccess } from "../core/output";
import { buildRemoteClient, resolveFileToken, runRemoteAction } from "./support";

function redactCommand(parts: string[], sensitiveIndexes?: Set<number>): string {
  if (!sensitiveIndexes || sensitiveIndexes.size === 0) {
    return parts.join(" ");
  }

  return parts
    .map((part, index) => (sensitiveIndexes.has(index) ? "********" : part))
    .join(" ");
}

export function createFilesDefinition(context: AppContext): CommandDefinition {
  return {
    name: "files",
    path: "files",
    kind: "group",
    summary: "Remote file helpers",
    authRequired: "conditional",
    destructive: false,
    confirmationRequired: false,
    children: [
      {
        name: "token",
        path: "files.token",
        kind: "command",
        summary: "Generate a temporary file token",
        authRequired: true,
        destructive: false,
        confirmationRequired: false,
        build: () =>
          new Command("token")
            .description("Generate a temporary file token")
            .action(async () => {
              await recordCommand(context, "files token");
              await runRemoteAction(context, {
                action: "files.token",
                successMessage: "File token generated",
                operation: (client) => client.filesToken()
              });
            })
      },
      {
        name: "url",
        path: "files.url",
        kind: "command",
        summary: "Build a PocketBase file URL",
        authRequired: "conditional",
        destructive: false,
        confirmationRequired: false,
        parameters: [
          {
            kind: "argument",
            name: "collection",
            required: true,
            nargs: 1,
            type: "TEXT"
          },
          {
            kind: "argument",
            name: "record_id",
            required: true,
            nargs: 1,
            type: "TEXT"
          },
          {
            kind: "argument",
            name: "filename",
            required: true,
            nargs: 1,
            type: "TEXT"
          },
          {
            kind: "option",
            name: "--thumb",
            names: ["--thumb"],
            required: false,
            takes_value: true,
            is_flag: false,
            nargs: 1,
            type: "TEXT"
          },
          {
            kind: "option",
            name: "--download",
            names: ["--download"],
            required: false,
            takes_value: false,
            is_flag: true,
            nargs: 1,
            type: "BOOLEAN"
          },
          {
            kind: "option",
            name: "--token",
            names: ["--token"],
            required: false,
            takes_value: true,
            is_flag: false,
            nargs: 1,
            type: "TEXT"
          },
          {
            kind: "option",
            name: "--with-token",
            names: ["--with-token"],
            required: false,
            takes_value: false,
            is_flag: true,
            nargs: 1,
            type: "BOOLEAN"
          }
        ],
        build: () =>
          new Command("url")
            .description("Build a PocketBase file URL")
            .argument("<collection>")
            .argument("<record_id>")
            .argument("<filename>")
            .option("--thumb <spec>", "PocketBase thumb spec, for example 100x100")
            .option("--download", "Force download with PocketBase download=1")
            .option("--token <token>", "Optional file token query parameter")
            .option("--with-token", "Fetch a temporary file token and append it automatically")
            .action(
              async (
                collection: string,
                recordId: string,
                filename: string,
                options: {
                  thumb?: string;
                  download?: boolean;
                  token?: string;
                  withToken?: boolean;
                }
              ) => {
                if (options.token && options.withToken) {
                  emitError({
                    jsonOutput: context.jsonMode,
                    action: "files.url",
                    message: "Use either `--token` or `--with-token`, not both.",
                    errorType: "invalid_input"
                  });
                }

                const historyParts = ["files", "url", collection, recordId, filename];
                if (options.thumb) {
                  historyParts.push("--thumb", options.thumb);
                }
                if (options.download) {
                  historyParts.push("--download");
                }

                const sensitiveIndexes = new Set<number>();
                if (options.token) {
                  historyParts.push("--token", options.token);
                  sensitiveIndexes.add(historyParts.length - 1);
                }
                if (options.withToken) {
                  historyParts.push("--with-token");
                }

                await recordCommand(
                  context,
                  redactCommand(historyParts, sensitiveIndexes.size > 0 ? sensitiveIndexes : undefined)
                );

                const client = buildRemoteClient(context, {
                  action: "files.url",
                  requireAuth: Boolean(options.withToken)
                });

                let resolvedToken = options.token ?? null;
                if (options.withToken) {
                  resolvedToken = await resolveFileToken(context, {
                    action: "files.url",
                    client
                  });
                }

                emitSuccess({
                  jsonOutput: context.jsonMode,
                  action: "files.url",
                  message: "File URL generated",
                  data: {
                    url: client.buildFileUrl({
                      collection,
                      recordId,
                      filename,
                      thumb: options.thumb ?? null,
                      download: Boolean(options.download),
                      token: resolvedToken
                    }),
                    collection,
                    record_id: recordId,
                    filename,
                    thumb: options.thumb ?? null,
                    download: Boolean(options.download),
                    token: resolvedToken
                  }
                });
              }
            )
      }
    ],
    build: () => new Command("files").description("Remote file helpers")
  };
}
