import { Command } from "commander";

import { AppContext, recordCommand, resolveAuthCollection, resolveBaseUrl } from "../app/context";
import type { CommandDefinition } from "../contract/command-registry";
import { emitError, emitSuccess } from "../core/output";
import { PocketBaseRemoteClient, PocketBaseRemoteError } from "../http/remote-client";
import { loadOptionalJsonObjectInput } from "../input/json-input";

function buildRawHistoryCommand(
  method: string,
  path: string,
  filePath?: string,
  stdinJson?: boolean
): string {
  if (filePath === "-") {
    return `raw ${method.toUpperCase()} ${path} --file -`;
  }
  if (stdinJson) {
    return `raw ${method.toUpperCase()} ${path} --stdin-json`;
  }
  return `raw ${method.toUpperCase()} ${path}`;
}

export function createRawDefinition(context: AppContext): CommandDefinition {
  return {
    name: "raw",
    path: "raw",
    kind: "command",
    summary: "Send a raw PocketBase HTTP request",
    authRequired: false,
    destructive: false,
    confirmationRequired: false,
    parameters: [
      {
        kind: "argument",
        name: "method",
        required: true,
        nargs: 1,
        type: "TEXT"
      },
      {
        kind: "argument",
        name: "path",
        required: true,
        nargs: 1,
        type: "TEXT"
      },
      {
        kind: "option",
        name: "--data",
        names: ["--data"],
        required: false,
        takes_value: true,
        is_flag: false,
        nargs: 1,
        type: "TEXT"
      },
      {
        kind: "option",
        name: "--file",
        names: ["--file"],
        required: false,
        takes_value: true,
        is_flag: false,
        nargs: 1,
        type: "TEXT"
      },
      {
        kind: "option",
        name: "--stdin-json",
        names: ["--stdin-json"],
        required: false,
        takes_value: false,
        is_flag: true,
        nargs: 1,
        type: "BOOLEAN"
      }
    ],
    build: () =>
      new Command("raw")
        .description("Send a raw PocketBase HTTP request")
        .argument("<method>")
        .argument("<path>")
        .option("--data <json>", "JSON object body")
        .option("--file <path>", "Path to a JSON file or `-` to read the body from stdin")
        .option("--stdin-json", "Read the JSON object body from stdin")
        .action(async (method: string, path: string, options: {
          data?: string;
          file?: string;
          stdinJson?: boolean;
        }) => {
          await recordCommand(
            context,
            buildRawHistoryCommand(method, path, options.file, options.stdinJson)
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

          const baseUrl = resolveBaseUrl(context);
          if (!baseUrl) {
            emitError({
              jsonOutput: context.jsonMode,
              action: "raw",
              message: "Base URL is required. Run `config set base_url <url>` first.",
              errorType: "missing_prerequisite",
              hint: "Persist a PocketBase base URL with `config set base_url <url>` first.",
              missingPrerequisite: "base_url"
            });
          }

          const client = new PocketBaseRemoteClient({
            baseUrl,
            token: context.state.remoteAuth.token,
            collection: resolveAuthCollection(context),
            timeout: context.state.config.timeout ?? null
          });

          try {
            const result = await client.raw({
              method,
              path,
              body: body ?? undefined,
              requireAuth: false
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
