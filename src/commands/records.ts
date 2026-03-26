import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { Command } from "commander";

import { AppContext, recordCommand, saveContextState } from "../app/context";
import type { CommandDefinition, CommandParameter } from "../contract/command-registry";
import { emitError, emitSuccess } from "../core/output";
import type { RemoteResult } from "../http/remote-client";
import { loadOptionalJsonObjectInput } from "../input/json-input";
import {
  buildRemoteClient,
  fetchAllPages,
  handleRemoteError,
  requireBaseUrl,
  requireConfirmation,
  runRemoteAction
} from "./support";

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function argumentParameter(name: string): CommandParameter {
  return {
    kind: "argument",
    name,
    required: true,
    nargs: 1,
    type: "TEXT"
  };
}

function optionParameter(options: {
  name: string;
  type: string;
  required?: boolean;
  isFlag?: boolean;
  multiple?: boolean;
}): CommandParameter {
  return {
    kind: "option",
    name: options.name,
    names: [options.name],
    required: options.required ?? false,
    takes_value: !(options.isFlag ?? false),
    is_flag: options.isFlag ?? false,
    multiple: options.multiple ?? false,
    nargs: 1,
    type: options.type
  };
}

function listOptionsParameters(): CommandParameter[] {
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
      name: "--fields",
      names: ["--fields"],
      required: false,
      takes_value: true,
      is_flag: false,
      nargs: 1,
      type: "TEXT"
    },
    {
      kind: "option",
      name: "--expand",
      names: ["--expand"],
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

function getOptionsParameters(): CommandParameter[] {
  return [
    {
      kind: "option",
      name: "--fields",
      names: ["--fields"],
      required: false,
      takes_value: true,
      is_flag: false,
      nargs: 1,
      type: "TEXT"
    },
    {
      kind: "option",
      name: "--expand",
      names: ["--expand"],
      required: false,
      takes_value: true,
      is_flag: false,
      nargs: 1,
      type: "TEXT"
    }
  ];
}

function findOptionsParameters(): CommandParameter[] {
  return [
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
      name: "--first",
      names: ["--first"],
      required: false,
      takes_value: false,
      is_flag: true,
      nargs: 1,
      type: "BOOLEAN"
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
      name: "--fields",
      names: ["--fields"],
      required: false,
      takes_value: true,
      is_flag: false,
      nargs: 1,
      type: "TEXT"
    },
    {
      kind: "option",
      name: "--expand",
      names: ["--expand"],
      required: false,
      takes_value: true,
      is_flag: false,
      nargs: 1,
      type: "TEXT"
    }
  ];
}

function mutationOptionsParameters(): CommandParameter[] {
  return [
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
    },
    {
      kind: "option",
      name: "--binary-file",
      names: ["--binary-file"],
      required: false,
      takes_value: true,
      is_flag: false,
      multiple: true,
      nargs: 1,
      type: "TEXT"
    }
  ];
}

type RecordMutationOptions = {
  data?: string;
  file?: string;
  stdinJson?: boolean;
  binaryFile?: string[];
};

type ParsedBinaryFile = {
  fieldName: string;
  filePath: string;
};

function redactCommand(parts: string[], sensitiveIndexes?: Set<number>): string {
  if (!sensitiveIndexes || sensitiveIndexes.size === 0) {
    return parts.join(" ");
  }

  return parts
    .map((part, index) => (sensitiveIndexes.has(index) ? "********" : part))
    .join(" ");
}

function expandHomePath(value: string): string {
  return value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
}

async function parseBinaryFileInputs(
  binaryFiles: string[],
  action: string
): Promise<ParsedBinaryFile[]> {
  const parsed: ParsedBinaryFile[] = [];

  for (const item of binaryFiles) {
    if (!item.includes("=")) {
      throw new Error(`${action} expected \`--binary-file\` in \`<field>=<path>\` format.`);
    }

    const [fieldNameRaw, pathRaw] = item.split("=", 2);
    const fieldName = fieldNameRaw.trim();
    const pathValue = pathRaw.trim();

    if (!fieldName) {
      throw new Error(
        `${action} expected \`--binary-file\` field name in \`<field>=<path>\` format.`
      );
    }
    if (!pathValue) {
      throw new Error(`${action} expected \`--binary-file\` path in \`<field>=<path>\` format.`);
    }

    const filePath = expandHomePath(pathValue);
    const fileStats = await stat(filePath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`${action} binary file does not exist: ${filePath}`);
      }
      throw error;
    });

    if (!fileStats.isFile()) {
      throw new Error(`${action} binary upload path is not a file: ${filePath}`);
    }

    parsed.push({
      fieldName,
      filePath
    });
  }

  return parsed;
}

async function loadRecordMutationInput(
  action: string,
  options: RecordMutationOptions
): Promise<{
  body: Record<string, unknown>;
  binaryFiles: ParsedBinaryFile[];
}> {
  const body = await loadOptionalJsonObjectInput({
    data: options.data,
    filePath: options.file,
    stdinJson: options.stdinJson,
    action
  });
  const binaryFiles = await parseBinaryFileInputs(options.binaryFile ?? [], action);

  if (body === null && binaryFiles.length === 0) {
    throw new Error(
      `${action} requires JSON input (\`--data\`, \`--file\`, \`--stdin-json\`) or at least one \`--binary-file\`.`
    );
  }

  return {
    body: body ?? {},
    binaryFiles
  };
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

function extractAuthPayload(
  result: RemoteResult<unknown>,
  action: string
): { token: string; record: Record<string, unknown> } {
  const payload =
    result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? (result.data as Record<string, unknown>)
      : {};

  const token = payload.token;
  const record = payload.record;

  if (typeof token !== "string" || !token.trim()) {
    throw new Error(`${action} response did not include a usable token`);
  }
  if (record !== undefined && (record === null || typeof record !== "object" || Array.isArray(record))) {
    throw new Error(`${action} response contained an invalid record payload`);
  }

  return {
    token,
    record: (record as Record<string, unknown> | undefined) ?? {}
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

async function saveRecordAuthResult(
  context: AppContext,
  options: {
    result: RemoteResult<unknown>;
    action: string;
    baseUrl: string;
    collection: string;
  }
): Promise<void> {
  let payload: { token: string; record: Record<string, unknown> };

  try {
    payload = extractAuthPayload(options.result, options.action);
  } catch (error) {
    emitError({
      jsonOutput: context.jsonMode,
      action: options.action.replace(/ /gu, "."),
      message: error instanceof Error ? error.message : String(error),
      data: options.result
    });
  }

  context.state.setRemoteAuth({
    baseUrl: options.baseUrl,
    token: payload.token,
    record: payload.record,
    collection: options.collection
  });
  await saveContextState(context);
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
    await saveRecordAuthResult(context, {
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
    data: options.result
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
    parameters: [
      {
        kind: "argument",
        name: "collection",
        required: true,
        nargs: 1,
        type: "TEXT"
      },
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

            const page = parseNumber(options.page);
            const perPage = parseNumber(options.perPage);

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
    parameters: [
      {
        kind: "argument",
        name: "collection",
        required: true,
        nargs: 1,
        type: "TEXT"
      },
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
                    perPage: parseNumber(options.perPage),
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
    parameters: [
      {
        kind: "argument",
        name: "collection",
        required: true,
        nargs: 1,
        type: "TEXT"
      },
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
      ...mutationOptionsParameters(),
      {
        kind: "option",
        name: "--first",
        names: ["--first"],
        required: false,
        takes_value: false,
        is_flag: true,
        nargs: 1,
        type: "BOOLEAN"
      },
      {
        kind: "option",
        name: "--fields",
        names: ["--fields"],
        required: false,
        takes_value: true,
        is_flag: false,
        nargs: 1,
        type: "TEXT"
      },
      {
        kind: "option",
        name: "--expand",
        names: ["--expand"],
        required: false,
        takes_value: true,
        is_flag: false,
        nargs: 1,
        type: "TEXT"
      }
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

            const expectCount = parseNumber(options.expectCount);
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
  return {
    name: "auth-methods",
    path: "records.auth-methods",
    kind: "command",
    summary: "Fetch record auth methods for a collection",
    authRequired: false,
    destructive: false,
    confirmationRequired: false,
    parameters: [argumentParameter("collection")],
    build: () =>
      new Command("auth-methods")
        .description("Fetch record auth methods for a collection")
        .argument("<collection>")
        .action(async (collection: string) => {
          await recordCommand(context, `records auth-methods ${collection}`);
          await runRemoteAction(context, {
            action: "records.auth-methods",
            successMessage: "Record auth methods fetch completed",
            requireAuth: false,
            operation: (client) => client.recordAuthMethods(collection)
          });
        })
  };
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
            const baseUrl = requireBaseUrl(context, {
              action: "records.auth-password"
            });

            const historyParts = ["records", "auth-password", collection];
            if (options.identityField) {
              historyParts.push("--identity-field", options.identityField);
            }
            if (options.fields) {
              historyParts.push("--fields", options.fields);
            }
            if (options.expand) {
              historyParts.push("--expand", options.expand);
            }
            if (options.mfaId) {
              historyParts.push("--mfa-id", options.mfaId);
            }
            if (options.save === false) {
              historyParts.push("--no-save");
            }
            historyParts.push(identity, password);
            await recordCommand(context, redactCommand(historyParts, new Set([historyParts.length - 1])));

            const client = buildRemoteClient(context, {
              action: "records.auth-password",
              requireAuth: false
            });

            try {
              const result = await client.recordAuthPassword({
                collection,
                identity,
                password,
                identityField: options.identityField,
                fields: options.fields,
                expand: options.expand,
                mfaId: options.mfaId
              });
              await emitRecordAuthOrMfaResult(context, {
                action: "records.auth-password",
                result,
                successMessage: "Record password auth completed",
                mfaMessage: "Record password auth requires MFA confirmation",
                baseUrl,
                collection,
                saveAuth: options.save !== false
              });
            } catch (error) {
              handleRemoteError(context, "records.auth-password", error);
            }
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
    parameters: [
      argumentParameter("collection"),
      optionParameter({ name: "--provider", type: "TEXT", required: true }),
      optionParameter({ name: "--code", type: "TEXT", required: true }),
      optionParameter({ name: "--redirect-url", type: "TEXT", required: true }),
      optionParameter({ name: "--code-verifier", type: "TEXT" }),
      optionParameter({ name: "--create-data", type: "TEXT" }),
      optionParameter({ name: "--create-file", type: "TEXT" }),
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
            const baseUrl = requireBaseUrl(context, {
              action: "records.auth-oauth2"
            });

            const historyParts = [
              "records",
              "auth-oauth2",
              collection,
              "--provider",
              options.provider,
              "--code",
              "********",
              "--redirect-url",
              options.redirectUrl
            ];
            if (options.codeVerifier) {
              historyParts.push("--code-verifier", "********");
            }
            if (options.createData) {
              historyParts.push("--create-data", "<json>");
            }
            if (options.createFile) {
              historyParts.push("--create-file", options.createFile);
            }
            if (options.fields) {
              historyParts.push("--fields", options.fields);
            }
            if (options.expand) {
              historyParts.push("--expand", options.expand);
            }
            if (options.save === false) {
              historyParts.push("--no-save");
            }
            await recordCommand(context, historyParts.join(" "));

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

            const client = buildRemoteClient(context, {
              action: "records.auth-oauth2",
              requireAuth: false
            });

            try {
              const result = await client.recordAuthOauth2({
                collection,
                provider: options.provider,
                code: options.code,
                redirectUrl: options.redirectUrl,
                codeVerifier: options.codeVerifier,
                createData: createPayload,
                fields: options.fields,
                expand: options.expand
              });
              await emitRecordAuthOrMfaResult(context, {
                action: "records.auth-oauth2",
                result,
                successMessage: "Record OAuth2 auth completed",
                mfaMessage: "Record OAuth2 auth requires MFA confirmation",
                baseUrl,
                collection,
                saveAuth: options.save !== false
              });
            } catch (error) {
              handleRemoteError(context, "records.auth-oauth2", error);
            }
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
            const historyParts = ["records", "auth-refresh", collection];
            if (options.fields) {
              historyParts.push("--fields", options.fields);
            }
            if (options.expand) {
              historyParts.push("--expand", options.expand);
            }
            if (options.save === false) {
              historyParts.push("--no-save");
            }
            await recordCommand(context, historyParts.join(" "));

            const client = buildRemoteClient(context, {
              action: "records.auth-refresh",
              requireAuth: true
            });

            try {
              const result = await client.recordAuthRefresh({
                collection,
                fields: options.fields,
                expand: options.expand
              });
              await emitRecordAuthOrMfaResult(context, {
                action: "records.auth-refresh",
                result,
                successMessage: "Record auth refresh completed",
                mfaMessage: "Record auth refresh requires MFA confirmation",
                baseUrl: client.baseUrl,
                collection,
                saveAuth: options.save !== false
              });
            } catch (error) {
              handleRemoteError(context, "records.auth-refresh", error);
            }
          }
        )
  };
}

function createRecordsRequestOtpDefinition(context: AppContext): CommandDefinition {
  return {
    name: "request-otp",
    path: "records.request-otp",
    kind: "command",
    summary: "Request a record OTP",
    authRequired: false,
    destructive: false,
    confirmationRequired: false,
    parameters: [argumentParameter("collection"), argumentParameter("email")],
    build: () =>
      new Command("request-otp")
        .description("Request a record OTP")
        .argument("<collection>")
        .argument("<email>")
        .action(async (collection: string, email: string) => {
          await recordCommand(context, `records request-otp ${collection} ${email}`);
          await runRemoteAction(context, {
            action: "records.request-otp",
            successMessage: "Record OTP request completed",
            requireAuth: false,
            operation: (client) =>
              client.recordRequestOtp({
                collection,
                email
              })
          });
        })
  };
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
            const baseUrl = requireBaseUrl(context, {
              action: "records.auth-otp"
            });

            const historyParts = ["records", "auth-otp", collection];
            if (options.fields) {
              historyParts.push("--fields", options.fields);
            }
            if (options.expand) {
              historyParts.push("--expand", options.expand);
            }
            if (options.mfaId) {
              historyParts.push("--mfa-id", options.mfaId);
            }
            if (options.save === false) {
              historyParts.push("--no-save");
            }
            historyParts.push(otpId, password);
            await recordCommand(context, redactCommand(historyParts, new Set([historyParts.length - 1])));

            const client = buildRemoteClient(context, {
              action: "records.auth-otp",
              requireAuth: false
            });

            try {
              const result = await client.recordAuthOtp({
                collection,
                otpId,
                password,
                fields: options.fields,
                expand: options.expand,
                mfaId: options.mfaId
              });
              await emitRecordAuthOrMfaResult(context, {
                action: "records.auth-otp",
                result,
                successMessage: "Record OTP auth completed",
                mfaMessage: "Record OTP auth requires MFA confirmation",
                baseUrl,
                collection,
                saveAuth: options.save !== false
              });
            } catch (error) {
              handleRemoteError(context, "records.auth-otp", error);
            }
          }
        )
  };
}

function createRecordsRequestPasswordResetDefinition(context: AppContext): CommandDefinition {
  return {
    name: "request-password-reset",
    path: "records.request-password-reset",
    kind: "command",
    summary: "Request a record password reset",
    authRequired: false,
    destructive: false,
    confirmationRequired: false,
    parameters: [argumentParameter("collection"), argumentParameter("email")],
    build: () =>
      new Command("request-password-reset")
        .description("Request a record password reset")
        .argument("<collection>")
        .argument("<email>")
        .action(async (collection: string, email: string) => {
          await recordCommand(context, `records request-password-reset ${collection} ${email}`);
          await runRemoteAction(context, {
            action: "records.request-password-reset",
            successMessage: "Record password reset request completed",
            requireAuth: false,
            operation: (client) =>
              client.recordRequestPasswordReset({
                collection,
                email
              })
          });
        })
  };
}

function createRecordsConfirmPasswordResetDefinition(context: AppContext): CommandDefinition {
  return {
    name: "confirm-password-reset",
    path: "records.confirm-password-reset",
    kind: "command",
    summary: "Confirm a record password reset",
    authRequired: false,
    destructive: false,
    confirmationRequired: false,
    parameters: [
      argumentParameter("collection"),
      argumentParameter("token"),
      argumentParameter("password"),
      argumentParameter("password_confirm")
    ],
    build: () =>
      new Command("confirm-password-reset")
        .description("Confirm a record password reset")
        .argument("<collection>")
        .argument("<token>")
        .argument("<password>")
        .argument("<password_confirm>")
        .action(
          async (
            collection: string,
            token: string,
            password: string,
            passwordConfirm: string
          ) => {
            await recordCommand(
              context,
              redactCommand(
                ["records", "confirm-password-reset", collection, token, password, passwordConfirm],
                new Set([3, 4, 5])
              )
            );
            await runRemoteAction(context, {
              action: "records.confirm-password-reset",
              successMessage: "Record password reset confirmation completed",
              requireAuth: false,
              operation: (client) =>
                client.recordConfirmPasswordReset({
                  collection,
                  token,
                  password,
                  passwordConfirm
                })
            });
          }
        )
  };
}

function createRecordsRequestVerificationDefinition(context: AppContext): CommandDefinition {
  return {
    name: "request-verification",
    path: "records.request-verification",
    kind: "command",
    summary: "Request record verification",
    authRequired: false,
    destructive: false,
    confirmationRequired: false,
    parameters: [argumentParameter("collection"), argumentParameter("email")],
    build: () =>
      new Command("request-verification")
        .description("Request record verification")
        .argument("<collection>")
        .argument("<email>")
        .action(async (collection: string, email: string) => {
          await recordCommand(context, `records request-verification ${collection} ${email}`);
          await runRemoteAction(context, {
            action: "records.request-verification",
            successMessage: "Record verification request completed",
            requireAuth: false,
            operation: (client) =>
              client.recordRequestVerification({
                collection,
                email
              })
          });
        })
  };
}

function createRecordsConfirmVerificationDefinition(context: AppContext): CommandDefinition {
  return {
    name: "confirm-verification",
    path: "records.confirm-verification",
    kind: "command",
    summary: "Confirm record verification",
    authRequired: false,
    destructive: false,
    confirmationRequired: false,
    parameters: [argumentParameter("collection"), argumentParameter("token")],
    build: () =>
      new Command("confirm-verification")
        .description("Confirm record verification")
        .argument("<collection>")
        .argument("<token>")
        .action(async (collection: string, token: string) => {
          await recordCommand(
            context,
            redactCommand(["records", "confirm-verification", collection, token], new Set([3]))
          );
          await runRemoteAction(context, {
            action: "records.confirm-verification",
            successMessage: "Record verification confirmation completed",
            requireAuth: false,
            operation: (client) =>
              client.recordConfirmVerification({
                collection,
                token
              })
          });
        })
  };
}

function createRecordsRequestEmailChangeDefinition(context: AppContext): CommandDefinition {
  return {
    name: "request-email-change",
    path: "records.request-email-change",
    kind: "command",
    summary: "Request record email change",
    authRequired: true,
    destructive: false,
    confirmationRequired: false,
    parameters: [argumentParameter("collection"), argumentParameter("new_email")],
    build: () =>
      new Command("request-email-change")
        .description("Request record email change")
        .argument("<collection>")
        .argument("<new_email>")
        .action(async (collection: string, newEmail: string) => {
          await recordCommand(context, `records request-email-change ${collection} ${newEmail}`);
          await runRemoteAction(context, {
            action: "records.request-email-change",
            successMessage: "Record email change request completed",
            operation: (client) =>
              client.recordRequestEmailChange({
                collection,
                newEmail
              })
          });
        })
  };
}

function createRecordsConfirmEmailChangeDefinition(context: AppContext): CommandDefinition {
  return {
    name: "confirm-email-change",
    path: "records.confirm-email-change",
    kind: "command",
    summary: "Confirm record email change",
    authRequired: false,
    destructive: false,
    confirmationRequired: false,
    parameters: [
      argumentParameter("collection"),
      argumentParameter("token"),
      argumentParameter("password")
    ],
    build: () =>
      new Command("confirm-email-change")
        .description("Confirm record email change")
        .argument("<collection>")
        .argument("<token>")
        .argument("<password>")
        .action(async (collection: string, token: string, password: string) => {
          await recordCommand(
            context,
            redactCommand(
              ["records", "confirm-email-change", collection, token, password],
              new Set([3, 4])
            )
          );
          await runRemoteAction(context, {
            action: "records.confirm-email-change",
            successMessage: "Record email change confirmation completed",
            requireAuth: false,
            operation: (client) =>
              client.recordConfirmEmailChange({
                collection,
                token,
                password
              })
          });
        })
  };
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
            const historyParts = ["records", "impersonate", collection, recordId];
            if (options.duration !== undefined) {
              historyParts.push("--duration", options.duration);
            }
            if (options.fields) {
              historyParts.push("--fields", options.fields);
            }
            if (options.expand) {
              historyParts.push("--expand", options.expand);
            }
            if (options.save === false) {
              historyParts.push("--no-save");
            }
            await recordCommand(context, historyParts.join(" "));

            const client = buildRemoteClient(context, {
              action: "records.impersonate",
              requireAuth: true
            });

            try {
              const result = await client.recordImpersonate({
                collection,
                recordId,
                duration: parseNumber(options.duration),
                fields: options.fields,
                expand: options.expand
              });
              await emitRecordAuthOrMfaResult(context, {
                action: "records.impersonate",
                result,
                successMessage: "Record impersonation completed",
                mfaMessage: "Record impersonation requires MFA confirmation",
                baseUrl: client.baseUrl,
                collection,
                saveAuth: options.save !== false
              });
            } catch (error) {
              handleRemoteError(context, "records.impersonate", error);
            }
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
