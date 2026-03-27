import { Command } from "commander";

export type AuthRequirement = boolean | "varies" | "conditional" | "unknown";
export type CommandKind = "root" | "group" | "command";

export interface CommandParameter {
  kind: "argument" | "option";
  name: string;
  aliases?: string[];
  names?: string[];
  required: boolean;
  takes_value?: boolean;
  is_flag?: boolean;
  multiple?: boolean;
  nargs?: number;
  default?: unknown;
  help?: string;
  type?: string;
  choices?: string[];
  conflicts_with?: string[];
  sensitive?: boolean;
}

export interface CommandDefinition {
  name: string;
  path: string;
  kind: Exclude<CommandKind, "root">;
  summary: string;
  hidden?: boolean;
  authRequired: AuthRequirement;
  destructive: boolean;
  confirmationRequired: boolean;
  confirmationFlag?: string | null;
  examples?: string[];
  notes?: string[];
  inputSchema?: Record<string, unknown> | null;
  parameters?: CommandParameter[];
  children?: CommandDefinition[];
  build?: () => Command;
}

export function normalizeSchemaPath(path: string): string {
  return path.trim().replace(/\./gu, " ").replace(/\s+/gu, " ").toLowerCase();
}

export function flattenCommandDefinitions(
  definitions: CommandDefinition[],
  includeHidden = false
): CommandDefinition[] {
  const result: CommandDefinition[] = [];
  const stack = definitions.slice().reverse();

  while (stack.length > 0) {
    const definition = stack.pop();
    if (!definition) {
      continue;
    }

    if (definition.hidden && !includeHidden) {
      continue;
    }

    result.push(definition);
    if (definition.children?.length) {
      for (let index = definition.children.length - 1; index >= 0; index -= 1) {
        stack.push(definition.children[index]);
      }
    }
  }

  return result;
}

export function registerCommandDefinitions(
  parent: Command,
  definitions: CommandDefinition[]
): void {
  for (const definition of definitions) {
    const command =
      definition.build?.() ?? new Command(definition.name).description(definition.summary);

    if (definition.children?.length) {
      registerCommandDefinitions(command, definition.children);
    }

    if (definition.hidden) {
      (command as Command & { _hidden: boolean })._hidden = true;
    }

    parent.addCommand(command);
  }
}
