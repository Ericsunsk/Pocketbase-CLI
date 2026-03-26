import { Command } from "commander";

import { AppContext } from "../app/context";
import type { CommandDefinition } from "../contract/command-registry";

export function createReplDefinition(
  _context: AppContext,
  runRepl: () => Promise<void>
): CommandDefinition {
  return {
    name: "repl",
    path: "repl",
    kind: "command",
    summary: "Start interactive REPL mode explicitly",
    authRequired: false,
    destructive: false,
    confirmationRequired: false,
    build: () =>
      new Command("repl")
        .description("Start interactive REPL mode explicitly")
        .action(async () => {
          await runRepl();
        })
  };
}
