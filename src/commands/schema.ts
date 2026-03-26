import { Command } from "commander";

import { AppContext } from "../app/context";
import type { CommandDefinition } from "../contract/command-registry";
import { normalizeSchemaPath } from "../contract/command-registry";
import { buildSchemaContract } from "../contract/schema";
import type { SchemaEntry } from "../contract/schema";
import { emitError, emitSuccess } from "../core/output";

interface CachedSchemaView {
  contract: Record<string, unknown>;
  knownPaths: Array<{
    path: string;
    normalized: string;
  }>;
  entriesByPath: Map<string, SchemaEntry>;
}

export function createSchemaDefinition(
  context: AppContext,
  definitionsProvider: () => CommandDefinition[]
): CommandDefinition {
  const cache = new Map<boolean, CachedSchemaView>();

  function getSchemaView(includeHidden: boolean): CachedSchemaView {
    const cached = cache.get(includeHidden);
    if (cached) {
      return cached;
    }

    const definitions = definitionsProvider();
    const contract = buildSchemaContract(definitions, includeHidden);
    const entries = contract.entries as SchemaEntry[];

    const entriesByPath = new Map<string, (typeof entries)[number]>();
    const knownPaths: Array<{ path: string; normalized: string }> = [];

    for (const entry of entries) {
      const normalized = normalizeSchemaPath(entry.path);
      entriesByPath.set(normalized, entry);

      if (entry.path !== "root") {
        knownPaths.push({
          path: entry.path,
          normalized
        });
      }
    }

    const view = {
      contract,
      knownPaths,
      entriesByPath
    };

    cache.set(includeHidden, view);
    return view;
  }

  return {
    name: "schema",
    path: "schema",
    kind: "command",
    summary: "Show machine-readable command schema for tools and LLM agents",
    authRequired: false,
    destructive: false,
    confirmationRequired: false,
    parameters: [
      {
        kind: "argument",
        name: "command_path",
        required: false,
        nargs: -1,
        type: "TEXT"
      },
      {
        kind: "option",
        name: "--json",
        names: ["--json"],
        required: false,
        takes_value: false,
        is_flag: true,
        nargs: 1,
        type: "BOOLEAN"
      },
      {
        kind: "option",
        name: "--include-hidden",
        names: ["--include-hidden"],
        required: false,
        takes_value: false,
        is_flag: true,
        nargs: 1,
        type: "BOOLEAN"
      }
    ],
    build: () =>
      new Command("schema")
        .description("Show machine-readable command schema for tools and LLM agents")
        .argument("[command_path...]")
        .option("--json", "Emit schema payload as JSON for tool/LLM usage")
        .option("--include-hidden", "Include hidden compatibility commands in schema output")
        .action((commandPath: string[] | undefined, options: { includeHidden?: boolean; json?: boolean }) => {
          const includeHidden = options.includeHidden ?? false;
          const jsonOutput = options.json ?? context.jsonMode;
          const { contract, entriesByPath, knownPaths } = getSchemaView(includeHidden);
          const normalizedPath = (commandPath ?? []).join(" ");
          const query = normalizeSchemaPath(normalizedPath);

          if (!commandPath || commandPath.length === 0) {
            emitSuccess({
              jsonOutput,
              action: "schema",
              message: "Command schema contract",
              data: contract
            });
            return;
          }

          const entry = entriesByPath.get(query) ?? null;
          if (!entry) {
            const suggestions: string[] = [];
            for (const candidate of knownPaths) {
              if (!candidate.normalized.startsWith(query)) {
                continue;
              }

              suggestions.push(candidate.path);
              if (suggestions.length >= 20) {
                break;
              }
            }

            emitError({
              jsonOutput,
              action: "schema",
              message: `Unknown command path: ${normalizedPath}`,
              data: {
                requested_path: normalizedPath,
                normalized_path: query,
                suggestions: suggestions.slice(0, 20)
              }
            });
          }

          emitSuccess({
            jsonOutput,
            action: "schema",
            message: "Command schema",
            data: entry
          });
        })
  };
}
