import type { CommandDefinition, CommandParameter } from "./command-registry";
import { flattenCommandDefinitions, normalizeSchemaPath } from "./command-registry";

export const CONTRACT_SCHEMA_VERSION = "1.1.0";

export interface SchemaEntry {
  name: string;
  path: string;
  kind: "root" | "group" | "command";
  summary: string;
  hidden: boolean;
  auth_required: boolean | string;
  destructive: boolean;
  confirmation_required: boolean;
  confirmation_flag: string | null;
  examples: string[];
  notes: string[];
  input_schema: Record<string, unknown> | null;
  parameters: unknown[];
  arguments: unknown[];
  options: unknown[];
  children: string[];
}

function childPaths(definition: CommandDefinition, includeHidden: boolean): string[] {
  const result: string[] = [];

  for (const child of definition.children ?? []) {
    if (!includeHidden && child.hidden) {
      continue;
    }

    result.push(child.path);
  }

  return result;
}

function formatDefinitionEntry(definition: CommandDefinition, includeHidden: boolean): SchemaEntry {
  const parameters: CommandParameter[] = [];
  const argumentsList: CommandParameter[] = [];
  const optionsList: CommandParameter[] = [];

  for (const parameter of definition.parameters ?? []) {
    parameters.push(parameter);

    if (parameter.kind === "argument") {
      argumentsList.push(parameter);
      continue;
    }

    if (parameter.kind === "option") {
      optionsList.push(parameter);
    }
  }

  return {
    name: definition.name,
    path: definition.path,
    kind: definition.kind,
    summary: definition.summary,
    hidden: Boolean(definition.hidden),
    auth_required: definition.authRequired,
    destructive: definition.destructive,
    confirmation_required: definition.confirmationRequired,
    confirmation_flag: definition.confirmationFlag ?? null,
    examples: [...(definition.examples ?? [])],
    notes: [...(definition.notes ?? [])],
    input_schema: definition.inputSchema ?? null,
    parameters,
    arguments: argumentsList,
    options: optionsList,
    children: childPaths(definition, includeHidden)
  };
}

export function buildSchemaContract(
  definitions: CommandDefinition[],
  includeHidden = false
): Record<string, unknown> {
  const filtered = includeHidden
    ? flattenCommandDefinitions(definitions, true)
    : flattenCommandDefinitions(definitions, false);

  const rootChildren: string[] = [];
  for (const definition of definitions) {
    if (!includeHidden && definition.hidden) {
      continue;
    }

    rootChildren.push(definition.path);
  }

  const root: SchemaEntry = {
    name: "root",
    path: "root",
    kind: "root",
    summary: "Remote-only PocketBase CLI root command",
    hidden: false,
    auth_required: "varies",
    destructive: false,
    confirmation_required: false,
    confirmation_flag: null,
    examples: ["pocketbase-cli --json info", "pocketbase-cli schema --json"],
    notes: [
      "Use `schema --json` for machine-readable command discovery.",
      "Command entries can include parameter help, enums, input_schema, and examples."
    ],
    input_schema: null,
    parameters: [],
    arguments: [],
    options: [],
    children: rootChildren
  };

  const commands = filtered
    .slice()
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((definition) => formatDefinitionEntry(definition, includeHidden));

  return {
    schema_version: CONTRACT_SCHEMA_VERSION,
    tool: "pocketbase-cli",
    mode: "remote-only",
    global_options: [
      {
        name: "--json",
        summary: "Emit machine-readable JSON output for command result payloads."
      }
    ],
    query_format: "schema <command path> --json",
    root,
    commands,
    entries: [root, ...commands]
  };
}

export function findSchemaEntry(
  definitions: CommandDefinition[],
  queryPath: string,
  includeHidden = false
): SchemaEntry | null {
  const contract = buildSchemaContract(definitions, includeHidden);
  const entries = contract.entries as SchemaEntry[];
  const query = normalizeSchemaPath(queryPath);

  if (query === "" || query === "root") {
    return entries[0] ?? null;
  }

  const entry = entries.find((candidate) => {
    if (candidate.path === "root") {
      return false;
    }

    return normalizeSchemaPath(candidate.path) === query;
  });

  return entry ?? null;
}
