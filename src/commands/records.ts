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
import type { RemoteResult } from "../http/remote-client";
import { loadOptionalJsonObjectInput } from "../input/json-input";
import { loadRecordMutationInput as loadSharedRecordMutationInput } from "../input/record-input";
import { parseIntegerOptionValue } from "../input/validators";
import { redactAuthResult, saveRemoteAuthResult } from "./auth-support";
import {
  buildRemoteClient,
  fetchAllPages,
  handleRemoteError,
  requireConfirmation,
  runRemoteAction
} from "./support";

function parseNumber(
  context: AppContext,
  action: string,
  optionName: string,
  value: string | undefined,
  minimum?: number
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    return parseIntegerOptionValue(
      optionName,
      value,
      minimum === undefined ? undefined : { min: minimum }
    );
  } catch (error) {
    emitError({
      jsonOutput: context.jsonMode,
      action,
      message: error instanceof Error ? error.message : String(error),
      errorType: "invalid_input"
    });
  }
}

const ARGUMENT_METADATA: Record<string, { help: string; sensitive?: boolean }> = {
  collection: {
    help: "PocketBase collection name"
  },
  record_id: {
    help: "PocketBase record id"
  },
  identity: {
    help: "Identity value such as an email address or username"
  },
  password: {
    help: "Password or OTP password value",
    sensitive: true
  },
  email: {
    help: "Email address"
  },
  otp_id: {
    help: "OTP id returned by `records request-otp`"
  },
  token: {
    help: "Confirmation token received from PocketBase",
    sensitive: true
  },
  password_confirm: {
    help: "Password confirmation value",
    sensitive: true
  },
  new_email: {
    help: "New email address to request or confirm"
  }
};

const OPTION_METADATA: Record<
  string,
  {
    help: string;
    sensitive?: boolean;
  }
> = {
  "--page": {
    help: "Page number for paginated responses"
  },
  "--per-page": {
    help: "Items per page"
  },
  "--filter": {
    help: "PocketBase filter expression"
  },
  "--sort": {
    help: "PocketBase sort expression"
  },
  "--fields": {
    help: "Comma-separated field projection"
  },
  "--expand": {
    help: "Comma-separated relation expansion list"
  },
  "--all": {
    help: "Fetch every page and merge the result into one payload"
  },
  "--first": {
    help: "Only use the first matching record"
  },
  "--identity-field": {
    help: "Explicit identity field name"
  },
  "--mfa-id": {
    help: "Existing MFA flow id to continue"
  },
  "--provider": {
    help: "OAuth2 provider name"
  },
  "--code": {
    help: "OAuth2 authorization code",
    sensitive: true
  },
  "--redirect-url": {
    help: "OAuth2 redirect URL used during authorization"
  },
  "--code-verifier": {
    help: "PKCE code verifier",
    sensitive: true
  },
  "--create-data": {
    help: "Inline JSON object for first-time OAuth2 record creation"
  },
  "--create-file": {
    help: "Path to a JSON file for first-time OAuth2 record creation"
  },
  "--no-save": {
    help: "Do not persist the returned auth token"
  },
  "--duration": {
    help: "Requested token duration in seconds"
  }
};

function argumentParameter(name: string): CommandParameter {
  const metadata = ARGUMENT_METADATA[name];

  return createArgumentParameter({
    name,
    help: metadata?.help,
    sensitive: metadata?.sensitive
  });
}

function optionParameter(options: {
  name: string;
  type: string;
  required?: boolean;
  isFlag?: boolean;
  multiple?: boolean;
  help?: string;
  choices?: string[];
  conflictsWith?: string[];
  sensitive?: boolean;
}): CommandParameter {
  const metadata = OPTION_METADATA[options.name];

  return createOptionParameter({
    ...options,
    help: options.help ?? metadata?.help,
    choices: options.choices,
    conflictsWith: options.conflictsWith,
    sensitive: options.sensitive ?? metadata?.sensitive
  });
}

function listOptionsParameters(): CommandParameter[] {
  return [
    optionParameter({ name: "--page", type: "INTEGER" }),
    optionParameter({ name: "--per-page", type: "INTEGER" }),
    optionParameter({ name: "--filter", type: "TEXT" }),
    optionParameter({ name: "--sort", type: "TEXT" }),
    optionParameter({ name: "--fields", type: "TEXT" }),
    optionParameter({ name: "--expand", type: "TEXT" }),
    optionParameter({ name: "--all", type: "BOOLEAN", isFlag: true })
  ];
}

function getOptionsParameters(): CommandParameter[] {
  return [
    optionParameter({ name: "--fields", type: "TEXT" }),
    optionParameter({ name: "--expand", type: "TEXT" })
  ];
}

function findOptionsParameters(): CommandParameter[] {
  return [
    optionParameter({ name: "--filter", type: "TEXT", required: true }),
    optionParameter({ name: "--first", type: "BOOLEAN", isFlag: true }),
    optionParameter({ name: "--per-page", type: "INTEGER" }),
    optionParameter({ name: "--sort", type: "TEXT" }),
    optionParameter({ name: "--fields", type: "TEXT" }),
    optionParameter({ name: "--expand", type: "TEXT" })
  ];
}

function mutationOptionsParameters(): CommandParameter[] {
  return [
    ...createJsonInputParameters(),
    createOptionParameter({
      name: "--binary-file",
      type: "TEXT",
      help: "Repeatable file upload in `<field>=<path>` format",
      multiple: true
    })
  ];
}

type RecordMutationOptions = {
  data?: string;
  file?: string;
  stdinJson?: boolean;
  binaryFile?: string[];
};

type RecordArgumentName = keyof typeof ARGUMENT_METADATA;

type HistorySegment =
  | {
      kind: "option";
      flag: string;
      value?: string | null;
      include?: boolean;
      renderValue?: string;
    }
  | {
      kind: "flag";
      flag: string;
      include: boolean;
    }
  | {
      kind: "value";
      value: string;
      sensitive?: boolean;
      renderValue?: string;
    };

function redactCommand(parts: string[], sensitiveIndexes?: Set<number>): string {
  if (!sensitiveIndexes || sensitiveIndexes.size === 0) {
    return parts.join(" ");
  }

  return parts
    .map((part, index) => (sensitiveIndexes.has(index) ? "********" : part))
    .join(" ");
}

async function loadRecordMutationInput(
  action: string,
  options: RecordMutationOptions
): Promise<{
  body: Record<string, unknown>;
  binaryFiles: Array<{ fieldName: string; filePath: string }>;
}> {
  return loadSharedRecordMutationInput({
    data: options.data,
    filePath: options.file,
    stdinJson: options.stdinJson,
    binaryFiles: options.binaryFile ?? [],
    action
  });
}

function buildMutationHistory(
  baseParts: string[],
  options: RecordMutationOptions
): string {
  const historyParts = [...baseParts];

  if (options.file === "-") {
    historyParts.push("--file", "-");
  } else if (options.stdinJson) {
    historyParts.push("--stdin-json");
  } else if (options.data !== undefined) {
    historyParts.push("--data", "<json>");
  } else if (options.file) {
    historyParts.push("--file", "<path>");
  }

  (options.binaryFile ?? []).forEach(() => {
    historyParts.push("--binary-file", "<field=path>");
  });

  return historyParts.join(" ");
}

function namedRecordArguments<TName extends string>(
  argumentNames: readonly TName[],
  values: string[]
): Record<TName, string> {
  return Object.fromEntries(
    argumentNames.map((argumentName, index) => [argumentName, values[index] ?? ""])
  ) as Record<TName, string>;
}

function buildPositionalRecordHistory(
  commandName: string,
  values: string[],
  sensitiveValueIndexes?: number[]
): string {
  const historyParts = ["records", commandName, ...values];
  const sensitiveIndexes =
    sensitiveValueIndexes && sensitiveValueIndexes.length > 0
      ? new Set(sensitiveValueIndexes.map((index) => index + 2))
      : undefined;

  return redactCommand(historyParts, sensitiveIndexes);
}

function buildRecordHistory(baseParts: string[], segments: HistorySegment[]): string {
  const historyParts = [...baseParts];
  const sensitiveIndexes = new Set<number>();

  for (const segment of segments) {
    if (segment.kind === "flag") {
      if (segment.include) {
        historyParts.push(segment.flag);
      }
      continue;
    }

    if (segment.kind === "option") {
      const include = segment.include ?? (segment.value !== undefined && segment.value !== null);
      if (!include) {
        continue;
      }
      historyParts.push(segment.flag);
      if (segment.value !== undefined && segment.value !== null) {
        historyParts.push(segment.renderValue ?? segment.value);
      }
      continue;
    }

    historyParts.push(segment.renderValue ?? segment.value);
    if (segment.sensitive) {
      sensitiveIndexes.add(historyParts.length - 1);
    }
  }

  return redactCommand(historyParts, sensitiveIndexes.size > 0 ? sensitiveIndexes : undefined);
}

function createSimpleRecordRemoteDefinition<TArgs extends RecordArgumentName>(
  context: AppContext,
  options: {
    name: string;
    path: string;
    summary: string;
    authRequired: boolean;
    argumentNames: readonly TArgs[];
    sensitiveValueIndexes?: number[];
    successMessage: string;
    operation: (
      client: ReturnType<typeof buildRemoteClient>,
      args: Record<TArgs, string>
    ) => Promise<RemoteResult<unknown>>;
  }
): CommandDefinition {
  return {
    name: options.name,
    path: options.path,
    kind: "command",
    summary: options.summary,
    authRequired: options.authRequired,
    destructive: false,
    confirmationRequired: false,
    parameters: options.argumentNames.map((argumentName) => argumentParameter(argumentName)),
    build: (): Command => {
      const command = new Command(options.name).description(options.summary);

      for (const argumentName of options.argumentNames) {
        command.argument(`<${argumentName}>`);
      }

      return command.action(async (...rawValues: string[]) => {
        const values = rawValues.slice(0, options.argumentNames.length);
        const args = namedRecordArguments(options.argumentNames, values);

        await recordCommand(
          context,
          buildPositionalRecordHistory(options.name, values, options.sensitiveValueIndexes)
        );

        await runRemoteAction(context, {
          action: options.path,
          successMessage: options.successMessage,
          requireAuth: options.authRequired,
          operation: (client) => options.operation(client, args)
        });
      });
    }
  };
}

function extractMfaPayload(
  result: RemoteResult<unknown>,
  action: string
): { mfaId: string } {
  const payload =
    result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? (result.data as Record<string, unknown>)
      : {};
  const mfaId = payload.mfaId;

  if (result.status !== 401) {
    throw new Error(`${action} did not return an MFA challenge`);
  }
  if (typeof mfaId !== "string" || !mfaId.trim()) {
    throw new Error(`${action} MFA challenge did not include a usable mfaId`);
  }

  return { mfaId };
}

async function emitRecordAuthOrMfaResult(
  context: AppContext,
  options: {
    action: string;
    result: RemoteResult<unknown>;
    successMessage: string;
    mfaMessage: string;
    baseUrl: string;
    collection: string;
    saveAuth: boolean;
  }
): Promise<void> {
  if (options.result.status === 401) {
    let payload: { mfaId: string };
    try {
      payload = extractMfaPayload(options.result, options.action.replace(/\./gu, " "));
    } catch (error) {
      emitError({
        jsonOutput: context.jsonMode,
        action: options.action,
        message: error instanceof Error ? error.message : String(error),
        data: options.result
      });
    }

    emitSuccess({
      jsonOutput: context.jsonMode,
      action: options.action,
      message: options.mfaMessage,
      data: {
        ...options.result,
        mfaId: payload.mfaId,
        mfa_required: true,
        saved: false
      }
    });
    return;
  }

  if (options.saveAuth) {
    await saveRemoteAuthResult(context, {
      result: options.result,
      action: options.action.replace(/\./gu, " "),
      baseUrl: options.baseUrl,
      collection: options.collection
    });
  }

  emitSuccess({
    jsonOutput: context.jsonMode,
    action: options.action,
    message: options.successMessage,
    data: redactAuthResult(options.result)
  });
}

async function runRecordAuthAction(
  context: AppContext,
  options: {
    action: string;
    collection: string;
    requireAuth: boolean;
    saveAuth: boolean;
    successMessage: string;
    mfaMessage: string;
    baseUrl?: string;
    operation: (client: ReturnType<typeof buildRemoteClient>) => Promise<RemoteResult<unknown>>;
  }
): Promise<void> {
  const client = buildRemoteClient(context, {
    action: options.action,
    requireAuth: options.requireAuth,
    collection: options.collection
  });

  try {
    const result = await options.operation(client);
    await emitRecordAuthOrMfaResult(context, {
      action: options.action,
      result,
      successMessage: options.successMessage,
      mfaMessage: options.mfaMessage,
      baseUrl: options.baseUrl ?? client.baseUrl,
      collection: options.collection,
      saveAuth: options.saveAuth
    });
  } catch (error) {
    handleRemoteError(context, options.action, error);
  }
}

async function executeRecordAuthCommand(
  context: AppContext,
  options: {
    history: string;
    action: string;
    collection: string;
    requireAuth: boolean;
    saveAuth: boolean;
    successMessage: string;
    mfaMessage: string;
    operation: (client: ReturnType<typeof buildRemoteClient>) => Promise<RemoteResult<unknown>>;
  }
): Promise<void> {
  await recordCommand(context, options.history);
  await runRecordAuthAction(context, {
    action: options.action,
    collection: options.collection,
    requireAuth: options.requireAuth,
    saveAuth: options.saveAuth,
    successMessage: options.successMessage,
    mfaMessage: options.mfaMessage,
    operation: options.operation
  });
}

function createRecordsListDefinition(context: AppContext): CommandDefinition {
  return {
    name: "list",
    path: "records.list",
    kind: "command",
    summary: "List records in a collection",
    authRequired: true,
    destructive: false,
    confirmationRequired: false,
    examples: [
      "pocketbase-cli --json records list users --all",
      "pocketbase-cli --json records list users --filter 'verified=true' --fields id,email"
    ],
    parameters: [
      argumentParameter("collection"),
      ...listOptionsParameters()
    ],
    build: () =>
      new Command("list")
        .description("List records in a collection")
        .argument("<collection>")
        .option("--page <number>", "Page number")
        .option("--per-page <number>", "Results per page")
        .option("--filter <filter>", "Filter expression")
        .option("--sort <sort>", "Sort spec")
        .option("--fields <fields>", "Fields projection")
        .option("--expand <expand>", "Expand relation fields")
        .option("--all", "Fetch all pages and merge them into a single result payload")
        .action(
          async (
            collection: string,
            options: {
              page?: string;
              perPage?: string;
              filter?: string;
              sort?: string;
              fields?: string;
              expand?: string;
              all?: boolean;
            }
          ) => {
            await recordCommand(context, `records list ${collection}`);

            const page = parseNumber(context, "records.list", "--page", options.page, 1);
            const perPage = parseNumber(context, "records.list", "--per-page", options.perPage, 1);

            await runRemoteAction(context, {
              action: "records.list",
              successMessage: "Records list completed",
              operation: (client) =>
                options.all
                  ? fetchAllPages({
                      action: "records.list",
                      perPage,
                      fetchPage: (currentPage, currentPerPage) =>
                        client.recordsList({
                          collection,
                          page: currentPage,
                          perPage: currentPerPage,
                          filterValue: options.filter,
                          sort: options.sort,
                          fields: options.fields,
                          expand: options.expand
                        })
                    })
                  : client.recordsList({
                      collection,
                      page,
                      perPage,
                      filterValue: options.filter,
                      sort: options.sort,
                      fields: options.fields,
                      expand: options.expand
                    })
            });
          }
        )
  };
}

function createRecordsGetDefinition(context: AppContext): CommandDefinition {
  return {
    name: "get",
    path: "records.get",
    kind: "command",
    summary: "Fetch a single record",
    authRequired: true,
    destructive: false,
    confirmationRequired: false,
    examples: ["pocketbase-cli --json records get users RECORD_ID --expand profile"],
    parameters: [
      argumentParameter("collection"),
      argumentParameter("record_id"),
      ...getOptionsParameters()
    ],
    build: () =>
      new Command("get")
        .description("Fetch a single record")
        .argument("<collection>")
        .argument("<record_id>")
        .option("--fields <fields>", "Fields projection")
        .option("--expand <expand>", "Expand relation fields")
        .action(
          async (
            collection: string,
            recordId: string,
            options: { fields?: string; expand?: string }
          ) => {
            await recordCommand(context, `records get ${collection} ${recordId}`);
            await runRemoteAction(context, {
              action: "records.get",
              successMessage: "Record fetch completed",
              operation: (client) =>
                client.recordsGet({
                  collection,
                  recordId,
                  fields: options.fields,
                  expand: options.expand
                })
            });
          }
        )
  };
}

function createRecordsFindDefinition(context: AppContext): CommandDefinition {
  return {
    name: "find",
    path: "records.find",
    kind: "command",
    summary: "Find records by PocketBase filter",
    authRequired: true,
    destructive: false,
    confirmationRequired: false,
    examples: [
      "pocketbase-cli --json records find users --filter 'email = \"demo@example.com\"' --first"
    ],
    parameters: [
      argumentParameter("collection"),
      ...findOptionsParameters()
    ],
    build: () =>
      new Command("find")
        .description("Find records by PocketBase filter")
        .argument("<collection>")
        .requiredOption("--filter <filter>", "PocketBase filter expression")
        .option("--first", "Return only the first matched record")
        .option("--per-page <number>", "Results per page")
        .option("--sort <sort>", "Sort spec")
        .option("--fields <fields>", "Fields projection")
        .option("--expand <expand>", "Expand relation fields")
        .action(
          async (
            collection: string,
            options: {
              filter: string;
              first?: boolean;
              perPage?: string;
              sort?: string;
              fields?: string;
              expand?: string;
            }
          ) => {
            const historyParts = ["records", "find", collection, "--filter", options.filter];
            if (options.first) {
              historyParts.push("--first");
            }
            if (options.perPage !== undefined) {
              historyParts.push("--per-page", options.perPage);
            }
            if (options.sort) {
              historyParts.push("--sort", options.sort);
            }
            if (options.fields) {
              historyParts.push("--fields", options.fields);
            }
            if (options.expand) {
              historyParts.push("--expand", options.expand);
            }
            await recordCommand(context, historyParts.join(" "));

            try {
              const result = options.first
                ? await runFindFirstPage(context, {
                    collection,
                    filterValue: options.filter,
                    sort: options.sort,
                    fields: options.fields,
                    expand: options.expand
                  })
                : await fetchAllPages({
                    action: "records.find",
                    perPage: parseNumber(context, "records.find", "--per-page", options.perPage, 1),
                    fetchPage: (currentPage, currentPerPage) =>
                      runFindListPage(context, {
                        collection,
                        page: currentPage,
                        perPage: currentPerPage,
                        filterValue: options.filter,
                        sort: options.sort,
                        fields: options.fields,
                        expand: options.expand
                      })
                  });

              const payload =
                result.data && typeof result.data === "object" && !Array.isArray(result.data)
                  ? (result.data as Record<string, unknown>)
                  : null;

              if (!payload || !Array.isArray(payload.items)) {
                emitError({
                  jsonOutput: context.jsonMode,
                  action: "records.find",
                  message: "records.find expected a paginated response with an `items` array"
                });
              }

              const items = payload.items as unknown[];
              emitSuccess({
                jsonOutput: context.jsonMode,
                action: "records.find",
                message: "Record filter query completed",
                data: {
                  collection,
                  filter: options.filter,
                  matched_count:
                    typeof payload.totalItems === "number" ? payload.totalItems : items.length,
                  found: items.length > 0,
                  record: items[0] ?? null,
                  items,
                  page_info: payload
                }
              });
            } catch (error) {
              handleRemoteError(context, "records.find", error);
            }
          }
        )
  };
}

function collectValues(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function createRecordsCreateDefinition(context: AppContext): CommandDefinition {
  return {
    name: "create",
    path: "records.create",
    kind: "command",
    summary: "Create a record",
    authRequired: true,
    destructive: false,
    confirmationRequired: false,
    examples: [
      "printf '{\"email\":\"demo@example.com\"}\\n' | pocketbase-cli --json records create users --stdin-json",
      "pocketbase-cli --json records create users --file payload.json --binary-file avatar=./avatar.png"
    ],
    notes: [
      "Use either JSON input, one or more `--binary-file` values, or both.",
      "`--binary-file` expects `<field>=<path>` and can be repeated."
    ],
    inputSchema: createObjectInputSchema({
      description: "Record create JSON body. The exact shape depends on the target collection schema.",
      additionalProperties: true
    }),
    parameters: [
      argumentParameter("collection"),
      ...mutationOptionsParameters()
    ],
    build: () =>
      new Command("create")
        .description("Create a record")
        .argument("<collection>")
        .option("--data <json>", "JSON object body")
        .option("--file <path>", "Path to a JSON file or `-` to read from stdin")
        .option("--stdin-json", "Read the JSON object body from stdin")
        .option(
          "--binary-file <field=path>",
          "Repeatable file upload in `<field>=<path>` format",
          collectValues,
          []
        )
        .action(async (collection: string, options: RecordMutationOptions) => {
          await recordCommand(context, buildMutationHistory(["records", "create", collection], options));

          let input: Awaited<ReturnType<typeof loadRecordMutationInput>>;
          try {
            input = await loadRecordMutationInput("records.create", options);
          } catch (error) {
            emitError({
              jsonOutput: context.jsonMode,
              action: "records.create",
              message: error instanceof Error ? error.message : String(error),
              errorType: "invalid_input"
            });
          }

          await runRemoteAction(context, {
            action: "records.create",
            successMessage: "Record create completed",
            operation: (client) =>
              input.binaryFiles.length > 0
                ? client.recordsCreateWithFiles({
                    collection,
                    body: input.body,
                    fileFields: input.binaryFiles
                  })
                : client.recordsCreate({
                    collection,
                    body: input.body
                  })
          });
        })
  };
}

function createRecordsUpdateDefinition(context: AppContext): CommandDefinition {
  return {
    name: "update",
    path: "records.update",
    kind: "command",
    summary: "Update a record",
    authRequired: true,
    destructive: false,
    confirmationRequired: false,
    examples: [
      "printf '{\"name\":\"Updated\"}\\n' | pocketbase-cli --json records update users RECORD_ID --stdin-json"
    ],
    notes: [
      "Use either JSON input, one or more `--binary-file` values, or both."
    ],
    inputSchema: createObjectInputSchema({
      description: "Record update JSON body. The exact shape depends on the target collection schema.",
      additionalProperties: true
    }),
    parameters: [
      argumentParameter("collection"),
      argumentParameter("record_id"),
      ...mutationOptionsParameters()
    ],
    build: () =>
      new Command("update")
        .description("Update a record")
        .argument("<collection>")
        .argument("<record_id>")
        .option("--data <json>", "JSON object body")
        .option("--file <path>", "Path to a JSON file or `-` to read from stdin")
        .option("--stdin-json", "Read the JSON object body from stdin")
        .option(
          "--binary-file <field=path>",
          "Repeatable file upload in `<field>=<path>` format",
          collectValues,
          []
        )
        .action(async (collection: string, recordId: string, options: RecordMutationOptions) => {
          await recordCommand(
            context,
            buildMutationHistory(["records", "update", collection, recordId], options)
          );

          let input: Awaited<ReturnType<typeof loadRecordMutationInput>>;
          try {
            input = await loadRecordMutationInput("records.update", options);
          } catch (error) {
            emitError({
              jsonOutput: context.jsonMode,
              action: "records.update",
              message: error instanceof Error ? error.message : String(error),
              errorType: "invalid_input"
            });
          }

          await runRemoteAction(context, {
            action: "records.update",
            successMessage: "Record update completed",
            operation: (client) =>
              input.binaryFiles.length > 0
                ? client.recordsUpdateWithFiles({
                    collection,
                    recordId,
                    body: input.body,
                    fileFields: input.binaryFiles
                  })
                : client.recordsUpdate({
                    collection,
                    recordId,
                    body: input.body
                  })
          });
        })
  };
}

function createRecordsUpsertDefinition(context: AppContext): CommandDefinition {
  return {
    name: "upsert",
    path: "records.upsert",
    kind: "command",
    summary: "Create or update a record matched by filter",
    authRequired: true,
    destructive: false,
    confirmationRequired: false,
    examples: [
      "printf '{\"email\":\"demo@example.com\",\"name\":\"Demo\"}\\n' | pocketbase-cli --json records upsert users --filter 'email = \"demo@example.com\"' --stdin-json"
    ],
    notes: [
      "The filter decides whether the request updates an existing record or creates a new one."
    ],
    inputSchema: createObjectInputSchema({
      description: "Record upsert JSON body. The exact shape depends on the target collection schema.",
      additionalProperties: true
    }),
    parameters: [
      argumentParameter("collection"),
      optionParameter({ name: "--filter", type: "TEXT", required: true }),
      ...mutationOptionsParameters(),
      optionParameter({ name: "--first", type: "BOOLEAN", isFlag: true }),
      optionParameter({ name: "--fields", type: "TEXT" }),
      optionParameter({ name: "--expand", type: "TEXT" })
    ],
    build: () =>
      new Command("upsert")
        .description("Create or update a record matched by filter")
        .argument("<collection>")
        .requiredOption("--filter <filter>", "PocketBase filter expression")
        .option("--data <json>", "JSON object body")
        .option("--file <path>", "Path to a JSON file or `-` to read from stdin")
        .option("--stdin-json", "Read the JSON object body from stdin")
        .option(
          "--binary-file <field=path>",
          "Repeatable file upload in `<field>=<path>` format",
          collectValues,
          []
        )
        .option("--first", "Update the first matched record when the filter matches multiple")
        .option("--fields <fields>", "Fields projection")
        .option("--expand <expand>", "Expand relation fields")
        .action(
          async (
            collection: string,
            options: RecordMutationOptions & {
              filter: string;
              first?: boolean;
              fields?: string;
              expand?: string;
            }
          ) => {
            const historyParts = ["records", "upsert", collection, "--filter", options.filter];
            if (options.file === "-") {
              historyParts.push("--file", "-");
            } else if (options.stdinJson) {
              historyParts.push("--stdin-json");
            } else if (options.file) {
              historyParts.push("--file", options.file);
            } else if (options.data !== undefined) {
              historyParts.push("--data", "<json>");
            } else if (!(options.binaryFile?.length)) {
              historyParts.push("--data", "<json>");
            }
            (options.binaryFile ?? []).forEach(() => {
              historyParts.push("--binary-file", "<field=path>");
            });
            if (options.first) {
              historyParts.push("--first");
            }
            if (options.fields) {
              historyParts.push("--fields", options.fields);
            }
            if (options.expand) {
              historyParts.push("--expand", options.expand);
            }
            await recordCommand(context, historyParts.join(" "));

            let input: Awaited<ReturnType<typeof loadRecordMutationInput>>;
            try {
              input = await loadRecordMutationInput("records.upsert", options);
            } catch (error) {
              emitError({
                jsonOutput: context.jsonMode,
                action: "records.upsert",
                message: error instanceof Error ? error.message : String(error),
                errorType: "invalid_input"
              });
            }

            const client = buildRemoteClient(context, {
              action: "records.upsert",
              requireAuth: true
            });

            try {
              const lookup = await client.recordsList({
                collection,
                page: 1,
                perPage: 2,
                filterValue: options.filter,
                sort: undefined,
                fields: options.fields,
                expand: options.expand
              });
              const payload =
                lookup.data && typeof lookup.data === "object" && !Array.isArray(lookup.data)
                  ? (lookup.data as Record<string, unknown>)
                  : null;
              const matchedItems = Array.isArray(payload?.items) ? payload.items : [];
              const matchedCount =
                typeof payload?.totalItems === "number" ? payload.totalItems : matchedItems.length;

              let result: RemoteResult<unknown>;
              let operation: "create" | "update";

              if (matchedCount === 0) {
                result =
                  input.binaryFiles.length > 0
                    ? await client.recordsCreateWithFiles({
                        collection,
                        body: input.body,
                        fileFields: input.binaryFiles
                      })
                    : await client.recordsCreate({
                        collection,
                        body: input.body
                      });
                operation = "create";
              } else {
                if (matchedCount !== 1 && !options.first) {
                  emitError({
                    jsonOutput: context.jsonMode,
                    action: "records.upsert",
                    message: `Filter matched ${matchedCount} records. Narrow the filter or pass \`--first\` to update the first match.`,
                    errorType: "invalid_input",
                    hint: "Use `records find <collection> --filter ...` to inspect matches before upsert.",
                    data: {
                      collection,
                      filter: options.filter,
                      matched_count: matchedCount
                    }
                  });
                }

                const target =
                  matchedItems[0] && typeof matchedItems[0] === "object" && !Array.isArray(matchedItems[0])
                    ? (matchedItems[0] as Record<string, unknown>)
                    : null;
                const targetId = target?.id;
                if (typeof targetId !== "string" || !targetId) {
                  emitError({
                    jsonOutput: context.jsonMode,
                    action: "records.upsert",
                    message: "Matched record did not include a usable `id`."
                  });
                }

                result =
                  input.binaryFiles.length > 0
                    ? await client.recordsUpdateWithFiles({
                        collection,
                        recordId: targetId,
                        body: input.body,
                        fileFields: input.binaryFiles
                      })
                    : await client.recordsUpdate({
                        collection,
                        recordId: targetId,
                        body: input.body
                      });
                operation = "update";
              }

              emitSuccess({
                jsonOutput: context.jsonMode,
                action: "records.upsert",
                message: "Record upsert completed",
                data: {
                  collection,
                  filter: options.filter,
                  matched_count: matchedCount,
                  operation,
                  data: result.data,
                  method: result.method,
                  url: result.url,
                  status: result.status
                }
              });
            } catch (error) {
              handleRemoteError(context, "records.upsert", error);
            }
          }
        )
  };
}

function createRecordsDeleteByFilterDefinition(context: AppContext): CommandDefinition {
  return {
    name: "delete-by-filter",
    path: "records.delete-by-filter",
    kind: "command",
    summary: "Delete records matched by filter",
    authRequired: true,
    destructive: true,
    confirmationRequired: true,
    confirmationFlag: "--yes",
    parameters: [
      {
        kind: "argument",
        name: "collection",
        required: true,
        nargs: 1,
        type: "TEXT"
      },
      {
        kind: "option",
        name: "--filter",
        names: ["--filter"],
        required: true,
        takes_value: true,
        is_flag: false,
        nargs: 1,
        type: "TEXT"
      },
      {
        kind: "option",
        name: "--expect-count",
        names: ["--expect-count"],
        required: false,
        takes_value: true,
        is_flag: false,
        nargs: 1,
        type: "INTEGER"
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
      new Command("delete-by-filter")
        .description("Delete records matched by filter")
        .argument("<collection>")
        .requiredOption("--filter <filter>", "PocketBase filter expression")
        .option("--expect-count <number>", "Fail unless the filter matches exactly this many records")
        .option("--yes", "Acknowledge that filtered deletion is destructive")
        .action(
          async (
            collection: string,
            options: {
              filter: string;
              expectCount?: string;
              yes?: boolean;
            }
          ) => {
            requireConfirmation(context, {
              action: "records.delete-by-filter",
              yes: Boolean(options.yes),
              message: "Filtered record deletion is destructive. Re-run with `--yes` to continue.",
              hint:
                "Re-run `records delete-by-filter <collection> --filter ... --yes` after verifying the matched set."
            });

            const historyParts = [
              "records",
              "delete-by-filter",
              collection,
              "--filter",
              options.filter,
              "--yes"
            ];
            if (options.expectCount !== undefined) {
              historyParts.push("--expect-count", options.expectCount);
            }
            await recordCommand(context, historyParts.join(" "));

            const expectCount = parseNumber(
              context,
              "records.delete-by-filter",
              "--expect-count",
              options.expectCount,
              0
            );
            const client = buildRemoteClient(context, {
              action: "records.delete-by-filter",
              requireAuth: true
            });

            try {
              const lookup = await fetchAllPages({
                action: "records.delete-by-filter",
                perPage: null,
                fetchPage: (currentPage, currentPerPage) =>
                  client.recordsList({
                    collection,
                    page: currentPage,
                    perPage: currentPerPage,
                    filterValue: options.filter,
                    sort: undefined,
                    fields: "id",
                    expand: undefined
                  })
              });

              const payload =
                lookup.data && typeof lookup.data === "object" && !Array.isArray(lookup.data)
                  ? (lookup.data as Record<string, unknown>)
                  : null;
              const items = Array.isArray(payload?.items) ? payload.items : [];
              const matchedCount = items.length;

              if (expectCount !== undefined && matchedCount !== expectCount) {
                emitError({
                  jsonOutput: context.jsonMode,
                  action: "records.delete-by-filter",
                  message: `Expected ${expectCount} records but matched ${matchedCount}.`,
                  errorType: "invalid_input",
                  hint:
                    "Use `records find <collection> --filter ...` to inspect the matched records first.",
                  data: {
                    collection,
                    filter: options.filter,
                    matched_count: matchedCount,
                    expected_count: expectCount
                  }
                });
              }

              const deletedIds: string[] = [];
              for (const item of items) {
                const recordId =
                  item && typeof item === "object" && !Array.isArray(item)
                    ? (item as Record<string, unknown>).id
                    : null;
                if (typeof recordId !== "string" || !recordId) {
                  continue;
                }
                await client.recordsDelete({
                  collection,
                  recordId
                });
                deletedIds.push(recordId);
              }

              emitSuccess({
                jsonOutput: context.jsonMode,
                action: "records.delete-by-filter",
                message: "Filtered record delete completed",
                data: {
                  collection,
                  filter: options.filter,
                  matched_count: matchedCount,
                  deleted_count: deletedIds.length,
                  deleted_ids: deletedIds
                }
              });
            } catch (error) {
              handleRemoteError(context, "records.delete-by-filter", error);
            }
          }
        )
  };
}

async function runFindFirstPage(
  context: AppContext,
  options: {
    collection: string;
    filterValue: string;
    sort?: string;
    fields?: string;
    expand?: string;
  }
): Promise<RemoteResult<Record<string, unknown>>> {
  const client = createFindClient(context);
  return client.recordsList({
    collection: options.collection,
    page: 1,
    perPage: 1,
    filterValue: options.filterValue,
    sort: options.sort,
    fields: options.fields,
    expand: options.expand
  });
}

async function runFindListPage(
  context: AppContext,
  options: {
    collection: string;
    page: number;
    perPage: number;
    filterValue: string;
    sort?: string;
    fields?: string;
    expand?: string;
  }
): Promise<RemoteResult<Record<string, unknown>>> {
  const client = createFindClient(context);
  return client.recordsList({
    collection: options.collection,
    page: options.page,
    perPage: options.perPage,
    filterValue: options.filterValue,
    sort: options.sort,
    fields: options.fields,
    expand: options.expand
  });
}

function createFindClient(context: AppContext): ReturnType<typeof buildRemoteClient> {
  return buildRemoteClient(context, {
    action: "records.find",
    requireAuth: true
  });
}

function createRecordsDeleteDefinition(context: AppContext): CommandDefinition {
  return {
    name: "delete",
    path: "records.delete",
    kind: "command",
    summary: "Delete a record",
    authRequired: true,
    destructive: true,
    confirmationRequired: true,
    confirmationFlag: "--yes",
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
        .description("Delete a record")
        .argument("<collection>")
        .argument("<record_id>")
        .option("--yes", "Acknowledge that deleting a record is destructive")
        .action(async (collection: string, recordId: string, options: { yes?: boolean }) => {
          requireConfirmation(context, {
            action: "records.delete",
            yes: Boolean(options.yes),
            message: "Record delete is destructive. Re-run with `--yes` to continue.",
            hint:
              "Re-run `records delete <collection> <record_id> --yes` after confirming the record id."
          });

          await recordCommand(context, `records delete ${collection} ${recordId} --yes`);
          await runRemoteAction(context, {
            action: "records.delete",
            successMessage: "Record delete completed",
            operation: (client) =>
              client.recordsDelete({
                collection,
                recordId
              })
          });
        })
  };
}

function createRecordsAuthMethodsDefinition(context: AppContext): CommandDefinition {
  return createSimpleRecordRemoteDefinition(context, {
    name: "auth-methods",
    path: "records.auth-methods",
    summary: "Fetch record auth methods for a collection",
    authRequired: false,
    argumentNames: ["collection"],
    successMessage: "Record auth methods fetch completed",
    operation: (client, args) => client.recordAuthMethods(args.collection)
  });
}

function createRecordsAuthPasswordDefinition(context: AppContext): CommandDefinition {
  return {
    name: "auth-password",
    path: "records.auth-password",
    kind: "command",
    summary: "Authenticate a record with password",
    authRequired: false,
    destructive: false,
    confirmationRequired: false,
    examples: [
      "pocketbase-cli --json records auth-password users demo@example.com Secret123 --fields id,email"
    ],
    notes: ["Use `--no-save` when the returned token should not overwrite the saved auth session."],
    parameters: [
      argumentParameter("collection"),
      argumentParameter("identity"),
      argumentParameter("password"),
      optionParameter({ name: "--identity-field", type: "TEXT" }),
      optionParameter({ name: "--fields", type: "TEXT" }),
      optionParameter({ name: "--expand", type: "TEXT" }),
      optionParameter({ name: "--mfa-id", type: "TEXT" }),
      optionParameter({ name: "--no-save", type: "BOOLEAN", isFlag: true })
    ],
    build: () =>
      new Command("auth-password")
        .description("Authenticate a record with password")
        .argument("<collection>")
        .argument("<identity>")
        .argument("<password>")
        .option("--identity-field <field>", "Explicit identity field")
        .option("--fields <fields>", "Fields projection")
        .option("--expand <expand>", "Expand relation fields")
        .option("--mfa-id <mfa_id>", "Continue an existing MFA flow")
        .option("--no-save", "Do not persist the returned auth token")
        .action(
          async (
            collection: string,
            identity: string,
            password: string,
            options: {
              identityField?: string;
              fields?: string;
              expand?: string;
              mfaId?: string;
              save?: boolean;
            }
          ) => {
            await executeRecordAuthCommand(context, {
              history: buildRecordHistory(["records", "auth-password", collection], [
                { kind: "option", flag: "--identity-field", value: options.identityField },
                { kind: "option", flag: "--fields", value: options.fields },
                { kind: "option", flag: "--expand", value: options.expand },
                { kind: "option", flag: "--mfa-id", value: options.mfaId },
                { kind: "flag", flag: "--no-save", include: options.save === false },
                { kind: "value", value: identity },
                { kind: "value", value: password, sensitive: true }
              ]),
              action: "records.auth-password",
              collection,
              requireAuth: false,
              saveAuth: options.save !== false,
              successMessage: "Record password auth completed",
              mfaMessage: "Record password auth requires MFA confirmation",
              operation: (client) =>
                client.recordAuthPassword({
                  collection,
                  identity,
                  password,
                  identityField: options.identityField,
                  fields: options.fields,
                  expand: options.expand,
                  mfaId: options.mfaId
                })
            });
          }
        )
  };
}

function createRecordsAuthOauth2Definition(context: AppContext): CommandDefinition {
  return {
    name: "auth-oauth2",
    path: "records.auth-oauth2",
    kind: "command",
    summary: "Authenticate a record with OAuth2",
    authRequired: false,
    destructive: false,
    confirmationRequired: false,
    examples: [
      "pocketbase-cli --json records auth-oauth2 users --provider google --code AUTH_CODE --redirect-url https://app.example.com/callback"
    ],
    notes: [
      "Use either `--create-data` or `--create-file` to provide first-time record creation payload."
    ],
    parameters: [
      argumentParameter("collection"),
      optionParameter({ name: "--provider", type: "TEXT", required: true }),
      optionParameter({ name: "--code", type: "TEXT", required: true }),
      optionParameter({ name: "--redirect-url", type: "TEXT", required: true }),
      optionParameter({ name: "--code-verifier", type: "TEXT" }),
      optionParameter({
        name: "--create-data",
        type: "TEXT",
        conflictsWith: ["--create-file"]
      }),
      optionParameter({
        name: "--create-file",
        type: "TEXT",
        conflictsWith: ["--create-data"]
      }),
      optionParameter({ name: "--fields", type: "TEXT" }),
      optionParameter({ name: "--expand", type: "TEXT" }),
      optionParameter({ name: "--no-save", type: "BOOLEAN", isFlag: true })
    ],
    build: () =>
      new Command("auth-oauth2")
        .description("Authenticate a record with OAuth2")
        .argument("<collection>")
        .requiredOption("--provider <provider>", "OAuth2 provider name")
        .requiredOption("--code <code>", "OAuth2 authorization code")
        .requiredOption("--redirect-url <url>", "OAuth2 redirect URL")
        .option("--code-verifier <verifier>", "Optional PKCE code verifier")
        .option("--create-data <json>", "Optional JSON object for first-time record creation")
        .option("--create-file <path>", "Path to a JSON file for first-time record creation")
        .option("--fields <fields>", "Fields projection")
        .option("--expand <expand>", "Expand relation fields")
        .option("--no-save", "Do not persist the returned auth token")
        .action(
          async (
            collection: string,
            options: {
              provider: string;
              code: string;
              redirectUrl: string;
              codeVerifier?: string;
              createData?: string;
              createFile?: string;
              fields?: string;
              expand?: string;
              save?: boolean;
            }
          ) => {
            let createPayload: Record<string, unknown> | null;
            try {
              createPayload = await loadOptionalJsonObjectInput({
                data: options.createData,
                filePath: options.createFile,
                stdinJson: false,
                action: "records.auth-oauth2"
              });
            } catch (error) {
              emitError({
                jsonOutput: context.jsonMode,
                action: "records.auth-oauth2",
                message: error instanceof Error ? error.message : String(error),
                errorType: "invalid_input"
              });
            }

            await executeRecordAuthCommand(context, {
              history: buildRecordHistory(["records", "auth-oauth2", collection], [
                { kind: "option", flag: "--provider", value: options.provider },
                {
                  kind: "option",
                  flag: "--code",
                  value: options.code,
                  renderValue: "********"
                },
                { kind: "option", flag: "--redirect-url", value: options.redirectUrl },
                {
                  kind: "option",
                  flag: "--code-verifier",
                  value: options.codeVerifier,
                  renderValue: "********"
                },
                {
                  kind: "option",
                  flag: "--create-data",
                  value: options.createData,
                  renderValue: "<json>"
                },
                { kind: "option", flag: "--create-file", value: options.createFile },
                { kind: "option", flag: "--fields", value: options.fields },
                { kind: "option", flag: "--expand", value: options.expand },
                { kind: "flag", flag: "--no-save", include: options.save === false }
              ]),
              action: "records.auth-oauth2",
              collection,
              requireAuth: false,
              saveAuth: options.save !== false,
              successMessage: "Record OAuth2 auth completed",
              mfaMessage: "Record OAuth2 auth requires MFA confirmation",
              operation: (client) =>
                client.recordAuthOauth2({
                  collection,
                  provider: options.provider,
                  code: options.code,
                  redirectUrl: options.redirectUrl,
                  codeVerifier: options.codeVerifier,
                  createData: createPayload,
                  fields: options.fields,
                  expand: options.expand
                })
            });
          }
        )
  };
}

function createRecordsAuthRefreshDefinition(context: AppContext): CommandDefinition {
  return {
    name: "auth-refresh",
    path: "records.auth-refresh",
    kind: "command",
    summary: "Refresh record auth token",
    authRequired: true,
    destructive: false,
    confirmationRequired: false,
    examples: ["pocketbase-cli --json records auth-refresh users --fields id,email"],
    parameters: [
      argumentParameter("collection"),
      optionParameter({ name: "--fields", type: "TEXT" }),
      optionParameter({ name: "--expand", type: "TEXT" }),
      optionParameter({ name: "--no-save", type: "BOOLEAN", isFlag: true })
    ],
    build: () =>
      new Command("auth-refresh")
        .description("Refresh record auth token")
        .argument("<collection>")
        .option("--fields <fields>", "Fields projection")
        .option("--expand <expand>", "Expand relation fields")
        .option("--no-save", "Do not persist the refreshed auth token")
        .action(
          async (
            collection: string,
            options: {
              fields?: string;
              expand?: string;
              save?: boolean;
            }
          ) => {
            await executeRecordAuthCommand(context, {
              history: buildRecordHistory(["records", "auth-refresh", collection], [
                { kind: "option", flag: "--fields", value: options.fields },
                { kind: "option", flag: "--expand", value: options.expand },
                { kind: "flag", flag: "--no-save", include: options.save === false }
              ]),
              action: "records.auth-refresh",
              collection,
              requireAuth: true,
              saveAuth: options.save !== false,
              successMessage: "Record auth refresh completed",
              mfaMessage: "Record auth refresh requires MFA confirmation",
              operation: (client) =>
                client.recordAuthRefresh({
                  collection,
                  fields: options.fields,
                  expand: options.expand
                })
            });
          }
        )
  };
}

function createRecordsRequestOtpDefinition(context: AppContext): CommandDefinition {
  return createSimpleRecordRemoteDefinition(context, {
    name: "request-otp",
    path: "records.request-otp",
    summary: "Request a record OTP",
    authRequired: false,
    argumentNames: ["collection", "email"],
    successMessage: "Record OTP request completed",
    operation: (client, args) =>
      client.recordRequestOtp({
        collection: args.collection,
        email: args.email
      })
  });
}

function createRecordsAuthOtpDefinition(context: AppContext): CommandDefinition {
  return {
    name: "auth-otp",
    path: "records.auth-otp",
    kind: "command",
    summary: "Authenticate a record with OTP",
    authRequired: false,
    destructive: false,
    confirmationRequired: false,
    parameters: [
      argumentParameter("collection"),
      argumentParameter("otp_id"),
      argumentParameter("password"),
      optionParameter({ name: "--fields", type: "TEXT" }),
      optionParameter({ name: "--expand", type: "TEXT" }),
      optionParameter({ name: "--mfa-id", type: "TEXT" }),
      optionParameter({ name: "--no-save", type: "BOOLEAN", isFlag: true })
    ],
    build: () =>
      new Command("auth-otp")
        .description("Authenticate a record with OTP")
        .argument("<collection>")
        .argument("<otp_id>")
        .argument("<password>")
        .option("--fields <fields>", "Fields projection")
        .option("--expand <expand>", "Expand relation fields")
        .option("--mfa-id <mfa_id>", "Continue an existing MFA flow")
        .option("--no-save", "Do not persist the returned auth token")
        .action(
          async (
            collection: string,
            otpId: string,
            password: string,
            options: {
              fields?: string;
              expand?: string;
              mfaId?: string;
              save?: boolean;
            }
          ) => {
            await executeRecordAuthCommand(context, {
              history: buildRecordHistory(["records", "auth-otp", collection], [
                { kind: "option", flag: "--fields", value: options.fields },
                { kind: "option", flag: "--expand", value: options.expand },
                { kind: "option", flag: "--mfa-id", value: options.mfaId },
                { kind: "flag", flag: "--no-save", include: options.save === false },
                { kind: "value", value: otpId },
                { kind: "value", value: password, sensitive: true }
              ]),
              action: "records.auth-otp",
              collection,
              requireAuth: false,
              saveAuth: options.save !== false,
              successMessage: "Record OTP auth completed",
              mfaMessage: "Record OTP auth requires MFA confirmation",
              operation: (client) =>
                client.recordAuthOtp({
                  collection,
                  otpId,
                  password,
                  fields: options.fields,
                  expand: options.expand,
                  mfaId: options.mfaId
                })
            });
          }
        )
  };
}

function createRecordsRequestPasswordResetDefinition(context: AppContext): CommandDefinition {
  return createSimpleRecordRemoteDefinition(context, {
    name: "request-password-reset",
    path: "records.request-password-reset",
    summary: "Request a record password reset",
    authRequired: false,
    argumentNames: ["collection", "email"],
    successMessage: "Record password reset request completed",
    operation: (client, args) =>
      client.recordRequestPasswordReset({
        collection: args.collection,
        email: args.email
      })
  });
}

function createRecordsConfirmPasswordResetDefinition(context: AppContext): CommandDefinition {
  return createSimpleRecordRemoteDefinition(context, {
    name: "confirm-password-reset",
    path: "records.confirm-password-reset",
    summary: "Confirm a record password reset",
    authRequired: false,
    argumentNames: ["collection", "token", "password", "password_confirm"],
    sensitiveValueIndexes: [1, 2, 3],
    successMessage: "Record password reset confirmation completed",
    operation: (client, args) =>
      client.recordConfirmPasswordReset({
        collection: args.collection,
        token: args.token,
        password: args.password,
        passwordConfirm: args.password_confirm
      })
  });
}

function createRecordsRequestVerificationDefinition(context: AppContext): CommandDefinition {
  return createSimpleRecordRemoteDefinition(context, {
    name: "request-verification",
    path: "records.request-verification",
    summary: "Request record verification",
    authRequired: false,
    argumentNames: ["collection", "email"],
    successMessage: "Record verification request completed",
    operation: (client, args) =>
      client.recordRequestVerification({
        collection: args.collection,
        email: args.email
      })
  });
}

function createRecordsConfirmVerificationDefinition(context: AppContext): CommandDefinition {
  return createSimpleRecordRemoteDefinition(context, {
    name: "confirm-verification",
    path: "records.confirm-verification",
    summary: "Confirm record verification",
    authRequired: false,
    argumentNames: ["collection", "token"],
    sensitiveValueIndexes: [1],
    successMessage: "Record verification confirmation completed",
    operation: (client, args) =>
      client.recordConfirmVerification({
        collection: args.collection,
        token: args.token
      })
  });
}

function createRecordsRequestEmailChangeDefinition(context: AppContext): CommandDefinition {
  return createSimpleRecordRemoteDefinition(context, {
    name: "request-email-change",
    path: "records.request-email-change",
    summary: "Request record email change",
    authRequired: true,
    argumentNames: ["collection", "new_email"],
    successMessage: "Record email change request completed",
    operation: (client, args) =>
      client.recordRequestEmailChange({
        collection: args.collection,
        newEmail: args.new_email
      })
  });
}

function createRecordsConfirmEmailChangeDefinition(context: AppContext): CommandDefinition {
  return createSimpleRecordRemoteDefinition(context, {
    name: "confirm-email-change",
    path: "records.confirm-email-change",
    summary: "Confirm record email change",
    authRequired: false,
    argumentNames: ["collection", "token", "password"],
    sensitiveValueIndexes: [1, 2],
    successMessage: "Record email change confirmation completed",
    operation: (client, args) =>
      client.recordConfirmEmailChange({
        collection: args.collection,
        token: args.token,
        password: args.password
      })
  });
}

function createRecordsImpersonateDefinition(context: AppContext): CommandDefinition {
  return {
    name: "impersonate",
    path: "records.impersonate",
    kind: "command",
    summary: "Impersonate a record auth session",
    authRequired: true,
    destructive: false,
    confirmationRequired: false,
    examples: [
      "pocketbase-cli --json records impersonate users RECORD_ID --duration 300"
    ],
    parameters: [
      argumentParameter("collection"),
      argumentParameter("record_id"),
      optionParameter({ name: "--duration", type: "INTEGER" }),
      optionParameter({ name: "--fields", type: "TEXT" }),
      optionParameter({ name: "--expand", type: "TEXT" }),
      optionParameter({ name: "--no-save", type: "BOOLEAN", isFlag: true })
    ],
    build: () =>
      new Command("impersonate")
        .description("Impersonate a record auth session")
        .argument("<collection>")
        .argument("<record_id>")
        .option("--duration <seconds>", "Optional auth token duration in seconds")
        .option("--fields <fields>", "Fields projection")
        .option("--expand <expand>", "Expand relation fields")
        .option("--no-save", "Do not persist the impersonation token")
        .action(
          async (
            collection: string,
            recordId: string,
            options: {
              duration?: string;
              fields?: string;
              expand?: string;
              save?: boolean;
            }
          ) => {
            await executeRecordAuthCommand(context, {
              history: buildRecordHistory(["records", "impersonate", collection, recordId], [
                { kind: "option", flag: "--duration", value: options.duration },
                { kind: "option", flag: "--fields", value: options.fields },
                { kind: "option", flag: "--expand", value: options.expand },
                { kind: "flag", flag: "--no-save", include: options.save === false }
              ]),
              action: "records.impersonate",
              collection,
              requireAuth: true,
              saveAuth: options.save !== false,
              successMessage: "Record impersonation completed",
              mfaMessage: "Record impersonation requires MFA confirmation",
              operation: (client) =>
                client.recordImpersonate({
                  collection,
                  recordId,
                  duration: parseNumber(
                    context,
                    "records.impersonate",
                    "--duration",
                    options.duration,
                    1
                  ),
                  fields: options.fields,
                  expand: options.expand
                })
            });
          }
        )
  };
}

export function createRecordsDefinition(context: AppContext): CommandDefinition {
  return {
    name: "records",
    path: "records",
    kind: "group",
    summary: "Remote records endpoints",
    authRequired: true,
    destructive: false,
    confirmationRequired: false,
    children: [
      createRecordsAuthMethodsDefinition(context),
      createRecordsAuthPasswordDefinition(context),
      createRecordsAuthOauth2Definition(context),
      createRecordsAuthRefreshDefinition(context),
      createRecordsRequestOtpDefinition(context),
      createRecordsAuthOtpDefinition(context),
      createRecordsRequestPasswordResetDefinition(context),
      createRecordsConfirmPasswordResetDefinition(context),
      createRecordsRequestVerificationDefinition(context),
      createRecordsConfirmVerificationDefinition(context),
      createRecordsRequestEmailChangeDefinition(context),
      createRecordsConfirmEmailChangeDefinition(context),
      createRecordsImpersonateDefinition(context),
      createRecordsListDefinition(context),
      createRecordsGetDefinition(context),
      createRecordsCreateDefinition(context),
      createRecordsUpdateDefinition(context),
      createRecordsFindDefinition(context),
      createRecordsUpsertDefinition(context),
      createRecordsDeleteByFilterDefinition(context),
      createRecordsDeleteDefinition(context)
    ],
    build: () => new Command("records").description("Remote records endpoints")
  };
}
