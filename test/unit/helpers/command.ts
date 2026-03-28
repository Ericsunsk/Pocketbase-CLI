import type { Command } from "commander";

import type { CommandDefinition } from "../../../src/contract/command-registry";

export function buildSubcommand(definition: CommandDefinition, name: string): Command {
  const child = definition.children?.find((candidate) => candidate.name === name);
  const command = child?.build?.();

  if (!command) {
    throw new Error(`Expected command definition to include subcommand \`${name}\``);
  }

  return command;
}
