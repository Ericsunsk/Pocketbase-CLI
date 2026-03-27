import type { AppContext } from "../app/context";
import type { CommandDefinition } from "../contract/command-registry";

import { createAuthDefinition } from "./auth";
import { createBackupsDefinition } from "./backups";
import { createBatchDefinition } from "./batch";
import { createCollectionsDefinition } from "./collections";
import { createConfigDefinition } from "./config";
import { createCronsDefinition } from "./crons";
import { createFilesDefinition } from "./files";
import { createHistoryCommandDefinitions } from "./history";
import { createInfoDefinition } from "./info";
import { createLogsDefinition } from "./logs";
import { createPreflightDefinition } from "./preflight";
import { createRawDefinition } from "./raw";
import { createRecordsDefinition } from "./records";
import { createReplDefinition } from "./repl";
import { createSchemaDefinition } from "./schema";
import { createSettingsDefinition } from "./settings";

const NOOP_REPL = async (): Promise<void> => undefined;

const COMMAND_DEFINITIONS_CACHE = new WeakMap<
  AppContext,
  {
    runRepl: () => Promise<void>;
    definitions: CommandDefinition[];
  }
>();

export function buildCommandDefinitions(
  context?: AppContext,
  options?: {
    runRepl?: () => Promise<void>;
  }
): CommandDefinition[] {
  if (!context) {
    return [];
  }

  const runRepl = options?.runRepl ?? NOOP_REPL;
  const cached = COMMAND_DEFINITIONS_CACHE.get(context);
  if (cached && cached.runRepl === runRepl) {
    return cached.definitions;
  }

  const definitions: CommandDefinition[] = [
    createReplDefinition(context, runRepl),
    createInfoDefinition(context),
    createPreflightDefinition(context),
    createRawDefinition(context),
    createConfigDefinition(context),
    createAuthDefinition(context),
    createSettingsDefinition(context),
    createLogsDefinition(context),
    createCronsDefinition(context),
    createCollectionsDefinition(context),
    createFilesDefinition(context),
    createBackupsDefinition(context),
    createRecordsDefinition(context),
    createBatchDefinition(context),
    ...createHistoryCommandDefinitions(context)
  ];

  definitions.splice(1, 0, createSchemaDefinition(context, () => definitions));

  COMMAND_DEFINITIONS_CACHE.set(context, {
    runRepl,
    definitions
  });

  return definitions;
}
