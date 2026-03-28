import { Command } from "commander";

import { AppContext, recordCommand } from "../app/context";
import type { CommandDefinition } from "../contract/command-registry";
import { emitError, emitSuccess } from "../core/output";
import { buildRemoteClient, resolveFileToken, runRemoteAction } from "./support";

const REDACTED_SECRET = "********";

function redactCommand(parts: string[], sensitiveIndexes?: Set<number>): string {
  if (!sensitiveIndexes || sensitiveIndexes.size === 0) {
    return parts.join(" ");
  }

  return parts
    .map((part, index) => (sensitiveIndexes.has(index) ? REDACTED_SECRET : part))
    .join(" ");
}

function sanitizeTokenizedUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("token")) {
      parsed.searchParams.set("token", REDACTED_SECRET);
    }

    return parsed.toString();
  } catch {
    return url.replace(/([?&]token=)[^&#]+/giu, `$1${REDACTED_SECRET}`);
  }
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
          },
          {
            kind: "option",
            name: "--reveal-token",
            names: ["--reveal-token"],
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
            .option("--reveal-token", "Print the resolved token and signed file URL to stdout")
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
                  revealToken?: boolean;
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

                if (options.revealToken && !options.token && !options.withToken) {
                  emitError({
                    jsonOutput: context.jsonMode,
                    action: "files.url",
                    message: "Use `--reveal-token` only together with `--token` or `--with-token`.",
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
                if (options.revealToken) {
                  historyParts.push("--reveal-token");
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

                const rawUrl = client.buildFileUrl({
                  collection,
                  recordId,
                  filename,
                  thumb: options.thumb ?? null,
                  download: Boolean(options.download)
                });
                const signedUrl = client.buildFileUrl({
                  collection,
                  recordId,
                  filename,
                  thumb: options.thumb ?? null,
                  download: Boolean(options.download),
                  token: resolvedToken
                });
                const tokenSource = options.withToken
                  ? "generated"
                  : options.token
                    ? "provided"
                    : null;
                const revealToken = Boolean(options.revealToken && resolvedToken);

                emitSuccess({
                  jsonOutput: context.jsonMode,
                  action: "files.url",
                  message: "File URL generated",
                  data: {
                    url: rawUrl,
                    collection,
                    record_id: recordId,
                    filename,
                    thumb: options.thumb ?? null,
                    download: Boolean(options.download),
                    token: resolvedToken ? (revealToken ? resolvedToken : REDACTED_SECRET) : null,
                    token_applied: Boolean(resolvedToken),
                    token_source: tokenSource,
                    url_with_token: resolvedToken
                      ? revealToken
                        ? signedUrl
                        : sanitizeTokenizedUrl(signedUrl)
                      : null,
                    sensitive_output: revealToken
                  }
                });
              }
            )
      }
    ],
    build: () => new Command("files").description("Remote file helpers")
  };
}
