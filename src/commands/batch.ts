import { Command } from "commander";

import { AppContext, recordCommand } from "../app/context";
import type { CommandDefinition } from "../contract/command-registry";
import { createJsonInputParameters, createObjectInputSchema } from "../contract/metadata";
import { emitError } from "../core/output";
import { loadJsonObjectInput } from "../input/json-input";
import { parseBatchPayload } from "../input/remote-payloads";
import { runRemoteAction } from "./support";

type JsonInputOptions = {
  data?: string;
  file?: string;
  stdinJson?: boolean;
};

function buildHistory(options: JsonInputOptions): string {
  if (options.file === "-") {
    return "batch run --file -";
  }

  if (options.stdinJson) {
    return "batch run --stdin-json";
  }

  if (options.file) {
    return `batch run --file ${options.file}`;
  }

  if (options.data !== undefined) {
    return "batch run --data <json>";
  }

  return "batch run";
}

export function createBatchDefinition(context: AppContext): CommandDefinition {
  return {
    name: "batch",
    path: "batch",
    kind: "group",
    summary: "Remote batch helpers",
    authRequired: true,
    destructive: false,
    confirmationRequired: false,
    children: [
      {
        name: "run",
        path: "batch.run",
        kind: "command",
        summary: "Run a validated PocketBase batch request",
        authRequired: true,
        destructive: false,
        confirmationRequired: false,
        examples: [
          "printf '{\"requests\":[{\"method\":\"POST\",\"url\":\"/api/collections/users/records\",\"body\":{\"email\":\"demo@example.com\"}}]}\\n' | pocketbase-cli --json batch run --stdin-json"
        ],
        notes: [
          "Only a constrained subset of record CRUD endpoints is accepted by `batch run`."
        ],
        inputSchema: createObjectInputSchema({
          description: "Validated PocketBase batch payload.",
          properties: {
            requests: {
              type: "array",
              description: "Non-empty array of record CRUD request objects."
            }
          },
          required: ["requests"],
          additionalProperties: true
        }),
        parameters: createJsonInputParameters(),
        build: () =>
          new Command("run")
            .description("Run a validated PocketBase batch request")
            .option("--data <json>", "Batch payload JSON object")
            .option("--file <path>", "Path to a JSON file containing the batch payload")
            .option("--stdin-json", "Read the batch payload JSON object from stdin")
            .action(async (options: JsonInputOptions) => {
              let body: Record<string, unknown>;
              try {
                const payload = await loadJsonObjectInput({
                  data: options.data,
                  filePath: options.file,
                  stdinJson: options.stdinJson,
                  action: "batch.run"
                });
                body = parseBatchPayload(payload);
              } catch (error) {
                emitError({
                  jsonOutput: context.jsonMode,
                  action: "batch.run",
                  message: error instanceof Error ? error.message : String(error)
                });
              }

              await recordCommand(context, buildHistory(options));

              await runRemoteAction(context, {
                action: "batch.run",
                successMessage: "Batch run completed",
                operation: (client) => client.batchRun({ body })
              });
            })
      }
    ],
    build: () => new Command("batch").description("Remote batch helpers")
  };
}
