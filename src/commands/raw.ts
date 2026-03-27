import { Command } from "commander";

import { AppContext, recordCommand } from "../app/context";
import type { CommandDefinition } from "../contract/command-registry";
import {
  createArgumentParameter,
  createJsonInputParameters,
  createObjectInputSchema,
  createOptionParameter
} from "../contract/metadata";
import { emitError, emitSuccess } from "../core/output";
import { PocketBaseRemoteError } from "../http/remote-client";
import { loadOptionalJsonObjectInput } from "../input/json-input";
import { buildRemoteClient } from "./support";

function buildRawHistoryCommand(
  method: string,
  path: string,
  filePath?: string,
  stdinJson?: boolean,
  withAuth?: boolean
): string {
  const parts = ["raw", method.toUpperCase(), path];

  if (filePath === "-") {
    parts.push("--file", "-");
  } else if (stdinJson) {
    parts.push("--stdin-json");
  }
  if (withAuth) {
    parts.push("--with-auth");
  }

  return parts.join(" ");
}

export function createRawDefinition(context: AppContext): CommandDefinition {
  return {
    name: "raw",
    path: "raw",
    kind: "command",
    summary: "Send a raw PocketBase HTTP request",
    authRequired: "conditional",
    destructive: false,
    confirmationRequired: false,
    examples: [
      "pocketbase-cli --json raw GET /api/health",
      "printf '{\"name\":\"demo\"}\\n' | pocketbase-cli --json raw POST /api/collections/tags/records --stdin-json --with-auth"
    ],
    notes: [
      "`raw` is anonymous by default; pass `--with-auth` to attach the saved token explicitly.",
      "The response `result` field contains the decoded response body, while `data` keeps the transport wrapper."
    ],
    inputSchema: createObjectInputSchema({
      description:
        "Optional JSON request body used with methods such as POST, PUT, or PATCH.",
      additionalProperties: true,
      examples: [{ name: "demo" }]
    }),
    parameters: [
      createArgumentParameter({
        name: "method",
        help: "HTTP method such as GET, POST, PATCH, PUT, or DELETE"
      }),
      createArgumentParameter({
        name: "path",
        help: "PocketBase API path beginning with `/`, for example `/api/health`"
      }),
      ...createJsonInputParameters(),
      createOptionParameter({
        name: "--with-auth",
        type: "BOOLEAN",
        help: "Attach the saved remote auth token to the request",
        isFlag: true
      })
    ],
    build: () =>
      new Command("raw")
        .description("Send a raw PocketBase HTTP request")
        .argument("<method>")
        .argument("<path>")
        .option("--data <json>", "JSON object body")
        .option("--file <path>", "Path to a JSON file or `-` to read the body from stdin")
        .option("--stdin-json", "Read the JSON object body from stdin")
        .option("--with-auth", "Attach the saved remote auth token to the request")
        .action(async (method: string, path: string, options: {
          data?: string;
          file?: string;
          stdinJson?: boolean;
          withAuth?: boolean;
        }) => {
          await recordCommand(
            context,
            buildRawHistoryCommand(method, path, options.file, options.stdinJson, options.withAuth)
          );

          let body: Record<string, unknown> | null = null;
          try {
            body = await loadOptionalJsonObjectInput({
              data: options.data,
              filePath: options.file,
              stdinJson: options.stdinJson,
              action: "raw"
            });
          } catch (error) {
            emitError({
              jsonOutput: context.jsonMode,
              action: "raw",
              message: error instanceof Error ? error.message : String(error)
            });
          }

          const client = buildRemoteClient(context, {
            action: "raw",
            requireAuth: Boolean(options.withAuth)
          });

          try {
            const result = await client.raw({
              method,
              path,
              body: body ?? undefined,
              requireAuth: Boolean(options.withAuth),
              includeAuth: Boolean(options.withAuth)
            });

            emitSuccess({
              jsonOutput: context.jsonMode,
              action: "raw",
              message: "Raw request completed",
              data: result
            });
          } catch (error) {
            if (error instanceof PocketBaseRemoteError) {
              emitError({
                jsonOutput: context.jsonMode,
                action: "raw",
                message: error.message,
                data: error.toJSON(),
                httpStatus: error.status
              });
            }

            throw error;
          }
        })
  };
}
