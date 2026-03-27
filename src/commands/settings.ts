import { Command } from "commander";

import { AppContext, recordCommand } from "../app/context";
import type { CommandDefinition } from "../contract/command-registry";
import { createJsonInputParameters, createObjectInputSchema } from "../contract/metadata";
import { emitError } from "../core/output";
import type { RemoteResult } from "../http/remote-client";
import { loadJsonObjectInput } from "../input/json-input";
import { runRemoteAction } from "./support";

type JsonInputOptions = {
  data?: string;
  file?: string;
  stdinJson?: boolean;
};

async function buildBody(
  options: JsonInputOptions,
  action: string
): Promise<Record<string, unknown>> {
  return loadJsonObjectInput({
    data: options.data,
    filePath: options.file,
    stdinJson: options.stdinJson,
    action
  });
}

function buildInputHistory(action: string, options: JsonInputOptions): string {
  if (options.file === "-") {
    return `${action} --file -`;
  }
  if (options.stdinJson) {
    return `${action} --stdin-json`;
  }
  if (options.file) {
    return `${action} --file ${options.file}`;
  }
  if (options.data !== undefined) {
    return `${action} --data <json>`;
  }
  return action;
}

function validateS3TestBody(body: Record<string, unknown>): Record<string, unknown> {
  const filesystem = body.filesystem;
  if (filesystem !== "storage" && filesystem !== "backups") {
    throw new Error("Settings S3 test payload must include `filesystem` set to `storage` or `backups`");
  }
  return body;
}

function validateEmailTestBody(body: Record<string, unknown>): Record<string, unknown> {
  const email = body.email;
  const template = body.template;

  if (typeof email !== "string" || !email.trim()) {
    throw new Error("Settings email test payload must include a non-empty `email`");
  }
  if (typeof template !== "string" || !template.trim()) {
    throw new Error("Settings email test payload must include a non-empty `template`");
  }

  return body;
}

function validateAppleSecretBody(body: Record<string, unknown>): Record<string, unknown> {
  const required = ["clientId", "teamId", "keyId", "privateKey", "duration"];
  const missing = required.filter((key) => !(key in body));
  if (missing.length > 0) {
    throw new Error(
      `Apple client secret payload is missing required keys: ${missing.sort().join(", ")}`
    );
  }
  return body;
}

function createJsonBodyCommand(options: {
  context: AppContext;
  name: string;
  path: string;
  summary: string;
  successMessage: string;
  examples?: string[];
  notes?: string[];
  inputSchema?: Record<string, unknown>;
  validateBody?: (body: Record<string, unknown>) => Record<string, unknown>;
  run: (
    client: {
      settingsPatch: (payload: { body: Record<string, unknown> }) => Promise<RemoteResult<unknown>>;
      settingsTestS3: (payload: { body: Record<string, unknown> }) => Promise<RemoteResult<unknown>>;
      settingsTestEmail: (payload: { body: Record<string, unknown> }) => Promise<RemoteResult<unknown>>;
      settingsGenerateAppleClientSecret: (payload: { body: Record<string, unknown> }) => Promise<RemoteResult<unknown>>;
    },
    body: Record<string, unknown>
  ) => Promise<RemoteResult<unknown>>;
}): CommandDefinition {
  return {
    name: options.name,
    path: options.path,
    kind: "command",
    summary: options.summary,
    authRequired: true,
    destructive: false,
    confirmationRequired: false,
    examples: options.examples,
    notes: options.notes,
    inputSchema: options.inputSchema ?? createObjectInputSchema(),
    parameters: createJsonInputParameters(),
    build: () =>
      new Command(options.name)
        .description(options.summary)
        .option("--data <json>", "JSON object body")
        .option("--file <path>", "Path to a JSON file or `-` to read from stdin")
        .option("--stdin-json", "Read the JSON object body from stdin")
        .action(async (input: JsonInputOptions) => {
          let body: Record<string, unknown>;
          try {
            body = await buildBody(input, options.path);
            body = options.validateBody ? options.validateBody(body) : body;
          } catch (error) {
            emitError({
              jsonOutput: options.context.jsonMode,
              action: options.path,
              message: error instanceof Error ? error.message : String(error)
            });
          }

          await recordCommand(options.context, buildInputHistory(`settings ${options.name}`, input));

          await runRemoteAction(options.context, {
            action: options.path,
            successMessage: options.successMessage,
            operation: (client) => options.run(client, body)
          });
        })
  };
}

function createSettingsGetDefinition(context: AppContext): CommandDefinition {
  return {
    name: "get",
    path: "settings.get",
    kind: "command",
    summary: "Fetch remote settings",
    authRequired: true,
    destructive: false,
    confirmationRequired: false,
    examples: ["pocketbase-cli --json settings get"],
    build: () =>
      new Command("get")
        .description("Fetch remote settings")
        .action(async () => {
          await recordCommand(context, "settings get");
          await runRemoteAction(context, {
            action: "settings.get",
            successMessage: "Settings fetch completed",
            operation: (client) => client.settingsGet()
          });
        })
  };
}

export function createSettingsDefinition(context: AppContext): CommandDefinition {
  return {
    name: "settings",
    path: "settings",
    kind: "group",
    summary: "Remote settings endpoints",
    authRequired: true,
    destructive: false,
    confirmationRequired: false,
    children: [
      createSettingsGetDefinition(context),
      createJsonBodyCommand({
        context,
        name: "patch",
        path: "settings.patch",
        summary: "Patch remote settings",
        successMessage: "Settings patch completed",
        examples: [
          "printf '{\"meta\":{\"appName\":\"PocketBase\"}}\\n' | pocketbase-cli --json settings patch --stdin-json"
        ],
        notes: ["The request body is forwarded to PocketBase settings patch as-is."],
        inputSchema: createObjectInputSchema({
          description: "Partial PocketBase settings object.",
          additionalProperties: true
        }),
        run: (client, body) => client.settingsPatch({ body })
      }),
      createJsonBodyCommand({
        context,
        name: "test-s3",
        path: "settings.test-s3",
        summary: "Test remote S3 settings",
        successMessage: "Settings S3 test completed",
        examples: [
          "printf '{\"filesystem\":\"storage\"}\\n' | pocketbase-cli --json settings test-s3 --stdin-json"
        ],
        inputSchema: createObjectInputSchema({
          description: "S3 test payload.",
          properties: {
            filesystem: {
              type: "string",
              enum: ["storage", "backups"],
              description: "Which PocketBase filesystem to test."
            }
          },
          required: ["filesystem"],
          additionalProperties: true
        }),
        validateBody: validateS3TestBody,
        run: (client, body) => client.settingsTestS3({ body })
      }),
      createJsonBodyCommand({
        context,
        name: "test-email",
        path: "settings.test-email",
        summary: "Test remote email settings",
        successMessage: "Settings email test completed",
        examples: [
          "printf '{\"email\":\"ops@example.com\",\"template\":\"verification\"}\\n' | pocketbase-cli --json settings test-email --stdin-json"
        ],
        inputSchema: createObjectInputSchema({
          description: "Email test payload.",
          properties: {
            email: {
              type: "string",
              description: "Recipient email address used for the test send."
            },
            template: {
              type: "string",
              description: "PocketBase email template name to render."
            }
          },
          required: ["email", "template"],
          additionalProperties: true
        }),
        validateBody: validateEmailTestBody,
        run: (client, body) => client.settingsTestEmail({ body })
      }),
      createJsonBodyCommand({
        context,
        name: "apple-client-secret",
        path: "settings.apple-client-secret",
        summary: "Generate Apple client secret",
        successMessage: "Apple client secret generated",
        examples: [
          "printf '{\"clientId\":\"app.example\",\"teamId\":\"TEAM123\",\"keyId\":\"KEY123\",\"privateKey\":\"-----BEGIN PRIVATE KEY-----...\",\"duration\":300}\\n' | pocketbase-cli --json settings apple-client-secret --stdin-json"
        ],
        inputSchema: createObjectInputSchema({
          description: "Apple client secret generation payload.",
          properties: {
            clientId: { type: "string" },
            teamId: { type: "string" },
            keyId: { type: "string" },
            privateKey: { type: "string" },
            duration: { type: "integer" }
          },
          required: ["clientId", "teamId", "keyId", "privateKey", "duration"],
          additionalProperties: true
        }),
        validateBody: validateAppleSecretBody,
        run: (client, body) => client.settingsGenerateAppleClientSecret({ body })
      })
    ],
    build: () => new Command("settings").description("Remote settings endpoints")
  };
}
