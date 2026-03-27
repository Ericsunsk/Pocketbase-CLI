import { Command } from "commander";

import { AppContext, recordCommand } from "../app/context";
import type { CommandDefinition, CommandParameter } from "../contract/command-registry";
import {
  createArgumentParameter,
  createJsonInputParameters,
  createObjectInputSchema,
  createOptionParameter
} from "../contract/metadata";
import { emitError, emitSuccess } from "../core/output";
import { PocketBaseRemoteError, type RemoteResult } from "../http/remote-client";
import { loadJsonObjectInput } from "../input/json-input";
import {
  parseCollectionEnsurePayload,
  parseCollectionsImportPayload
} from "../input/remote-payloads";
import {
  buildRemoteClient,
  fetchAllPages,
  handleRemoteError,
  requireConfirmation,
  runRemoteAction
} from "./support";

type JsonInputOptions = {
  data?: string;
  file?: string;
  stdinJson?: boolean;
};

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function listParameters(): CommandParameter[] {
  return [
    createOptionParameter({
      name: "--page",
      type: "INTEGER",
      help: "Page number for paginated collection listing"
    }),
    createOptionParameter({
      name: "--per-page",
      type: "INTEGER",
      help: "Number of collections per page"
    }),
    createOptionParameter({
      name: "--filter",
      type: "TEXT",
      help: "PocketBase filter expression"
    }),
    createOptionParameter({
      name: "--sort",
      type: "TEXT",
      help: "PocketBase sort expression"
    }),
    createOptionParameter({
      name: "--all",
      type: "BOOLEAN",
      help: "Fetch every page and merge the result into a single payload",
      isFlag: true
    })
  ];
}

function ensureParameters(): CommandParameter[] {
  return [
    ...createJsonInputParameters(),
    createOptionParameter({
      name: "--if-exists",
      type: "TEXT",
      help: "Behavior when the collection already exists",
      default: "update",
      choices: ["update", "fail"]
    }),
    createOptionParameter({
      name: "--if-missing",
      type: "TEXT",
      help: "Behavior when the collection does not exist",
      default: "create",
      choices: ["create", "fail"]
    }),
    createOptionParameter({
      name: "--output",
      type: "TEXT",
      help: "Successful response detail level",
      default: "full",
      choices: ["summary", "full"]
    })
  ];
}

function buildInputHistory(base: string, options: JsonInputOptions): string {
  if (options.file === "-") {
    return `${base} --file -`;
  }
  if (options.stdinJson) {
    return `${base} --stdin-json`;
  }
  if (options.file) {
    return `${base} --file <path>`;
  }
  if (options.data !== undefined) {
    return `${base} --data <json>`;
  }
  return `${base} --file <path>`;
}

async function loadBody(
  action: string,
  options: JsonInputOptions
): Promise<Record<string, unknown>> {
  return loadJsonObjectInput({
    data: options.data,
    filePath: options.file,
    stdinJson: options.stdinJson,
    action
  });
}

function normalizeEnsurePolicies(options: {
  ifExists?: string;
  ifMissing?: string;
  output?: string;
}): {
  ifExists: "update" | "fail";
  ifMissing: "create" | "fail";
  outputMode: "summary" | "full";
} {
  const ifExists = (options.ifExists ?? "update").toLowerCase();
  const ifMissing = (options.ifMissing ?? "create").toLowerCase();
  const outputMode = (options.output ?? "full").toLowerCase();

  if (ifExists !== "update" && ifExists !== "fail") {
    throw new Error("collections.ensure expects `--if-exists` to be `update` or `fail`.");
  }
  if (ifMissing !== "create" && ifMissing !== "fail") {
    throw new Error("collections.ensure expects `--if-missing` to be `create` or `fail`.");
  }
  if (outputMode !== "summary" && outputMode !== "full") {
    throw new Error("collections.ensure expects `--output` to be `summary` or `full`.");
  }

  return {
    ifExists,
    ifMissing,
    outputMode
  };
}

async function loadJsonActionBody(
  context: AppContext,
  action: string,
  historyCommand: string,
  options: JsonInputOptions
): Promise<Record<string, unknown>> {
  await recordCommand(context, buildInputHistory(historyCommand, options));

  try {
    return await loadBody(action, options);
  } catch (error) {
    emitError({
      jsonOutput: context.jsonMode,
      action,
      message: error instanceof Error ? error.message : String(error),
      errorType: "invalid_input"
    });
  }
}

function createJsonBodyCommand(options: {
  context: AppContext;
  name: string;
  path: string;
  summary: string;
  successMessage: string;
  historyCommand: string;
  examples?: string[];
  notes?: string[];
  inputSchema?: Record<string, unknown>;
  validateBody?: (body: Record<string, unknown>) => Record<string, unknown>;
  run: (
    client: ReturnType<typeof buildRemoteClient>,
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
          let body = await loadJsonActionBody(
            options.context,
            options.path,
            options.historyCommand,
            input
          );

          try {
            body = options.validateBody ? options.validateBody(body) : body;
          } catch (error) {
            emitError({
              jsonOutput: options.context.jsonMode,
              action: options.path,
              message: error instanceof Error ? error.message : String(error),
              errorType: "invalid_input"
            });
          }

          await runRemoteAction(options.context, {
            action: options.path,
            successMessage: options.successMessage,
            operation: (client) => options.run(client, body)
          });
        })
  };
}

function createCollectionsListDefinition(context: AppContext): CommandDefinition {
  return {
    name: "list",
    path: "collections.list",
    kind: "command",
    summary: "List remote collections",
    authRequired: true,
    destructive: false,
    confirmationRequired: false,
    examples: [
      "pocketbase-cli --json collections list",
      "pocketbase-cli --json collections list --all"
    ],
    parameters: listParameters(),
    build: () =>
      new Command("list")
        .description("List remote collections")
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
          await recordCommand(context, "collections list");
          const page = parseNumber(options.page);
          const perPage = parseNumber(options.perPage);

          await runRemoteAction(context, {
            action: "collections.list",
            successMessage: "Collections list completed",
            operation: (client) =>
              options.all
                ? fetchAllPages({
                    action: "collections.list",
                    perPage,
                    fetchPage: (currentPage, currentPerPage) =>
                      client.collectionsList({
                        page: currentPage,
                        perPage: currentPerPage,
                        filterValue: options.filter,
                        sort: options.sort
                      })
                  })
                : client.collectionsList({
                    page,
                    perPage,
                    filterValue: options.filter,
                    sort: options.sort
                  })
          });
        })
  };
}

function createCollectionsGetDefinition(context: AppContext): CommandDefinition {
  return {
    name: "get",
    path: "collections.get",
    kind: "command",
    summary: "Fetch a single collection",
    authRequired: true,
    destructive: false,
    confirmationRequired: false,
    examples: ["pocketbase-cli --json collections get users"],
    parameters: [
      createArgumentParameter({
        name: "name_or_id",
        help: "Collection name or collection id"
      })
    ],
    build: () =>
      new Command("get")
        .description("Fetch a collection by name or id")
        .argument("<name_or_id>")
        .action(async (nameOrId: string) => {
          await recordCommand(context, `collections get ${nameOrId}`);
          await runRemoteAction(context, {
            action: "collections.get",
            successMessage: "Collection fetch completed",
            operation: (client) => client.collectionsGet(nameOrId)
          });
        })
  };
}

function createCollectionsUpdateDefinition(context: AppContext): CommandDefinition {
  return {
    name: "update",
    path: "collections.update",
    kind: "command",
    summary: "Update a collection",
    authRequired: true,
    destructive: false,
    confirmationRequired: false,
    examples: [
      "printf '{\"name\":\"users\",\"indexes\":[]}\\n' | pocketbase-cli --json collections update users --stdin-json"
    ],
    notes: ["The input body should be a full or partial PocketBase collection definition."],
    inputSchema: createObjectInputSchema({
      description: "PocketBase collection definition payload.",
      additionalProperties: true
    }),
    parameters: [
      createArgumentParameter({
        name: "name_or_id",
        help: "Collection name or collection id"
      }),
      ...createJsonInputParameters()
    ],
    build: () =>
      new Command("update")
        .description("Update a collection")
        .argument("<name_or_id>")
        .option("--data <json>", "JSON object body")
        .option("--file <path>", "Path to a JSON file or `-` to read from stdin")
        .option("--stdin-json", "Read the JSON object body from stdin")
        .action(async (nameOrId: string, input: JsonInputOptions) => {
          const body = await loadJsonActionBody(
            context,
            "collections.update",
            `collections update ${nameOrId}`,
            input
          );

          await runRemoteAction(context, {
            action: "collections.update",
            successMessage: "Collection update completed",
            operation: (client) =>
              client.collectionsUpdate({
                nameOrId,
                body
              })
          });
        })
  };
}

function createCollectionsEnsureDefinition(context: AppContext): CommandDefinition {
  return {
    name: "ensure",
    path: "collections.ensure",
    kind: "command",
    summary: "Create or update a collection idempotently",
    authRequired: true,
    destructive: false,
    confirmationRequired: false,
    examples: [
      "printf '{\"name\":\"users\",\"type\":\"base\"}\\n' | pocketbase-cli --json collections ensure --stdin-json",
      "pocketbase-cli --json collections ensure --file collection.json --if-exists fail --output summary"
    ],
    notes: [
      "`collections.ensure` requires a non-empty `name` in the JSON body.",
      "Use `--output summary` when the caller only needs the operation result instead of the full collection payload."
    ],
    inputSchema: createObjectInputSchema({
      description: "PocketBase collection definition used for idempotent ensure.",
      properties: {
        name: {
          type: "string",
          description: "Collection name used to resolve an existing collection before update."
        }
      },
      required: ["name"],
      additionalProperties: true
    }),
    parameters: ensureParameters(),
    build: () =>
      new Command("ensure")
        .description("Create or update a collection idempotently")
        .option("--data <json>", "JSON object body")
        .option("--file <path>", "Path to a JSON file or `-` to read from stdin")
        .option("--stdin-json", "Read the JSON object body from stdin")
        .option("--if-exists <mode>", "Behavior when the collection already exists", "update")
        .option("--if-missing <mode>", "Behavior when the collection does not exist", "create")
        .option("--output <mode>", "Successful response detail level", "full")
        .action(
          async (
            input: JsonInputOptions & {
              ifExists?: string;
              ifMissing?: string;
              output?: string;
            }
          ) => {
            const historyParts = [buildInputHistory("collections ensure", input)];
            if (input.ifExists && input.ifExists !== "update") {
              historyParts.push(`--if-exists ${input.ifExists}`);
            }
            if (input.ifMissing && input.ifMissing !== "create") {
              historyParts.push(`--if-missing ${input.ifMissing}`);
            }
            if (input.output && input.output !== "full") {
              historyParts.push(`--output ${input.output}`);
            }
            await recordCommand(context, historyParts.join(" "));

            let body: Record<string, unknown>;
            let lookupName: string;
            let ifExists: "update" | "fail";
            let ifMissing: "create" | "fail";
            let outputMode: "summary" | "full";

            try {
              body = await loadBody("collections.ensure", input);
              ({ body, lookupName } = parseCollectionEnsurePayload(body));
              ({ ifExists, ifMissing, outputMode } = normalizeEnsurePolicies(input));
            } catch (error) {
              emitError({
                jsonOutput: context.jsonMode,
                action: "collections.ensure",
                message: error instanceof Error ? error.message : String(error),
                errorType: "invalid_input"
              });
            }

            const client = buildRemoteClient(context, {
              action: "collections.ensure",
              requireAuth: true
            });
            let matched: Record<string, unknown> | null = null;

            try {
              const existing = await client.collectionsGet(lookupName);
              if (
                existing.data &&
                typeof existing.data === "object" &&
                !Array.isArray(existing.data)
              ) {
                matched = existing.data as Record<string, unknown>;
              }

              if (ifExists === "fail") {
                emitError({
                  jsonOutput: context.jsonMode,
                  action: "collections.ensure",
                  message: `Collection \`${lookupName}\` already exists and \`--if-exists fail\` was requested.`,
                  errorType: "invalid_input",
                  hint:
                    "Remove `--if-exists fail` to update the collection, or use `collections update` explicitly.",
                  data: {
                    lookup_name: lookupName,
                    matched,
                    if_exists: ifExists
                  }
                });
              }

              const result = await client.collectionsUpdate({
                nameOrId: lookupName,
                body
              });
              emitEnsureSuccess(context, {
                result,
                operation: "update",
                lookupName,
                matched,
                ifExists,
                ifMissing,
                outputMode
              });
            } catch (error) {
              if (!(error instanceof PocketBaseRemoteError) || error.status !== 404) {
                handleRemoteError(context, "collections.ensure", error);
              }

              if (ifMissing === "fail") {
                emitError({
                  jsonOutput: context.jsonMode,
                  action: "collections.ensure",
                  message: `Collection \`${lookupName}\` does not exist and \`--if-missing fail\` was requested.`,
                  errorType: "not_found",
                  hint:
                    "Remove `--if-missing fail` to create the collection, or create it explicitly with `collections create`.",
                  data: {
                    lookup_name: lookupName,
                    if_missing: ifMissing
                  },
                  httpStatus: 404
                });
              }

              try {
                const result = await client.collectionsCreate({ body });
                emitEnsureSuccess(context, {
                  result,
                  operation: "create",
                  lookupName,
                  matched,
                  ifExists,
                  ifMissing,
                  outputMode
                });
              } catch (createError) {
                handleRemoteError(context, "collections.ensure", createError);
              }
            }
          }
        )
  };
}

function emitEnsureSuccess(
  context: AppContext,
  options: {
    result: RemoteResult<unknown>;
    operation: "create" | "update";
    lookupName: string;
    matched: Record<string, unknown> | null;
    ifExists: string;
    ifMissing: string;
    outputMode: "summary" | "full";
  }
): void {
  const payload =
    options.result.data &&
    typeof options.result.data === "object" &&
    !Array.isArray(options.result.data)
      ? (options.result.data as Record<string, unknown>)
      : {};

  if (options.outputMode === "summary") {
    emitSuccess({
      jsonOutput: context.jsonMode,
      action: "collections.ensure",
      message: "Collection ensure completed",
      data: {
        operation: options.operation,
        lookup_name: options.lookupName,
        existed: options.matched !== null,
        status: options.result.status,
        collection: {
          id: payload.id ?? null,
          name: payload.name ?? null,
          type: payload.type ?? null
        },
        field_count: Array.isArray(payload.fields) ? payload.fields.length : null,
        policies: {
          if_exists: options.ifExists,
          if_missing: options.ifMissing
        },
        output: options.outputMode
      }
    });
    return;
  }

  emitSuccess({
    jsonOutput: context.jsonMode,
    action: "collections.ensure",
    message: "Collection ensure completed",
    data: {
      operation: options.operation,
      lookup_name: options.lookupName,
      matched: options.matched,
      if_exists: options.ifExists,
      if_missing: options.ifMissing,
      output: options.outputMode,
      data: options.result.data,
      method: options.result.method,
      url: options.result.url,
      status: options.result.status
    }
  });
}

function createCollectionsDeleteDefinition(context: AppContext): CommandDefinition {
  return {
    name: "delete",
    path: "collections.delete",
    kind: "command",
    summary: "Delete a collection",
    authRequired: true,
    destructive: true,
    confirmationRequired: true,
    confirmationFlag: "--yes",
    parameters: [
      {
        kind: "argument",
        name: "name_or_id",
        required: true,
        nargs: 1,
        type: "TEXT"
      },
      {
        kind: "option",
        name: "--yes",
        names: ["--yes"],
        required: false,
        takes_value: false,
        is_flag: true,
        nargs: 1,
        type: "BOOLEAN"
      }
    ],
    build: () =>
      new Command("delete")
        .description("Delete a collection")
        .argument("<name_or_id>")
        .option("--yes", "Acknowledge that deleting a collection is destructive")
        .action(async (nameOrId: string, options: { yes?: boolean }) => {
          requireConfirmation(context, {
            action: "collections.delete",
            yes: Boolean(options.yes),
            message: "Collection delete is destructive. Re-run with `--yes` to continue.",
            hint:
              "Re-run `collections delete <name_or_id> --yes` once you have verified the target collection."
          });

          await recordCommand(context, `collections delete ${nameOrId} --yes`);
          await runRemoteAction(context, {
            action: "collections.delete",
            successMessage: "Collection delete completed",
            operation: (client) => client.collectionsDelete(nameOrId)
          });
        })
  };
}

function createCollectionsTruncateDefinition(context: AppContext): CommandDefinition {
  return {
    name: "truncate",
    path: "collections.truncate",
    kind: "command",
    summary: "Remove all records from a collection",
    authRequired: true,
    destructive: true,
    confirmationRequired: true,
    confirmationFlag: "--yes",
    parameters: [
      {
        kind: "argument",
        name: "name_or_id",
        required: true,
        nargs: 1,
        type: "TEXT"
      },
      {
        kind: "option",
        name: "--yes",
        names: ["--yes"],
        required: false,
        takes_value: false,
        is_flag: true,
        nargs: 1,
        type: "BOOLEAN"
      }
    ],
    build: () =>
      new Command("truncate")
        .description("Truncate a collection")
        .argument("<name_or_id>")
        .option("--yes", "Acknowledge that truncating a collection removes all records")
        .action(async (nameOrId: string, options: { yes?: boolean }) => {
          requireConfirmation(context, {
            action: "collections.truncate",
            yes: Boolean(options.yes),
            message: "Collection truncate is destructive. Re-run with `--yes` to continue.",
            hint:
              "Re-run `collections truncate <name_or_id> --yes` after confirming the collection should be emptied."
          });

          await recordCommand(context, `collections truncate ${nameOrId} --yes`);
          await runRemoteAction(context, {
            action: "collections.truncate",
            successMessage: "Collection truncate completed",
            operation: (client) => client.collectionsTruncate(nameOrId)
          });
        })
  };
}

export function createCollectionsDefinition(context: AppContext): CommandDefinition {
  return {
    name: "collections",
    path: "collections",
    kind: "group",
    summary: "Remote collections endpoints",
    authRequired: true,
    destructive: false,
    confirmationRequired: false,
    children: [
      createCollectionsListDefinition(context),
      createCollectionsGetDefinition(context),
      createJsonBodyCommand({
        context,
        name: "create",
        path: "collections.create",
        summary: "Create a collection",
        successMessage: "Collection create completed",
        historyCommand: "collections create",
        examples: [
          "printf '{\"name\":\"users\",\"type\":\"base\"}\\n' | pocketbase-cli --json collections create --stdin-json"
        ],
        inputSchema: createObjectInputSchema({
          description: "PocketBase collection definition payload.",
          properties: {
            name: { type: "string" },
            type: { type: "string" }
          },
          required: ["name"],
          additionalProperties: true
        }),
        run: (client, body) => client.collectionsCreate({ body })
      }),
      createCollectionsUpdateDefinition(context),
      createCollectionsEnsureDefinition(context),
      createCollectionsDeleteDefinition(context),
      createCollectionsTruncateDefinition(context),
      createJsonBodyCommand({
        context,
        name: "import",
        path: "collections.import",
        summary: "Import collections payload",
        successMessage: "Collections import completed",
        historyCommand: "collections import",
        examples: [
          "printf '{\"collections\":[{\"name\":\"users\",\"type\":\"base\"}]}\\n' | pocketbase-cli --json collections import --stdin-json"
        ],
        inputSchema: createObjectInputSchema({
          description: "Collections import payload.",
          properties: {
            collections: {
              type: "array",
              description: "Non-empty array of PocketBase collection definitions."
            }
          },
          required: ["collections"],
          additionalProperties: true
        }),
        validateBody: parseCollectionsImportPayload,
        run: (client, body) => client.collectionsImport({ body })
      }),
      {
        name: "scaffolds",
        path: "collections.scaffolds",
        kind: "command",
        summary: "Fetch collection scaffolds metadata",
        authRequired: true,
        destructive: false,
        confirmationRequired: false,
        examples: ["pocketbase-cli --json collections scaffolds"],
        build: () =>
          new Command("scaffolds")
            .description("Fetch collection scaffolds metadata")
            .action(async () => {
              await recordCommand(context, "collections scaffolds");
              await runRemoteAction(context, {
                action: "collections.scaffolds",
                successMessage: "Collection scaffolds fetch completed",
                operation: (client) => client.collectionsScaffolds()
              });
            })
      }
    ],
    build: () => new Command("collections").description("Remote collections endpoints")
  };
}
