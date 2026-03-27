import type { CommandParameter } from "./command-registry";

export function createArgumentParameter(options: {
  name: string;
  help?: string;
  required?: boolean;
  type?: string;
  nargs?: number;
  sensitive?: boolean;
}): CommandParameter {
  return {
    kind: "argument",
    name: options.name,
    required: options.required ?? true,
    nargs: options.nargs ?? 1,
    type: options.type ?? "TEXT",
    help: options.help,
    sensitive: options.sensitive ?? false
  };
}

export function createOptionParameter(options: {
  name: string;
  type: string;
  help?: string;
  required?: boolean;
  isFlag?: boolean;
  multiple?: boolean;
  nargs?: number;
  default?: unknown;
  choices?: string[];
  conflictsWith?: string[];
  sensitive?: boolean;
}): CommandParameter {
  return {
    kind: "option",
    name: options.name,
    names: [options.name],
    required: options.required ?? false,
    takes_value: !(options.isFlag ?? false),
    is_flag: options.isFlag ?? false,
    multiple: options.multiple ?? false,
    nargs: options.nargs ?? 1,
    default: options.default,
    help: options.help,
    type: options.type,
    choices: options.choices,
    conflicts_with: options.conflictsWith,
    sensitive: options.sensitive ?? false
  };
}

export function createJsonInputParameters(options?: {
  includeStdinJson?: boolean;
  bodyLabel?: string;
}): CommandParameter[] {
  const bodyLabel = options?.bodyLabel ?? "JSON object body";
  const parameters: CommandParameter[] = [
    createOptionParameter({
      name: "--data",
      type: "TEXT",
      help: `Inline ${bodyLabel.toLowerCase()}`,
      conflictsWith: ["--file", "--stdin-json"]
    }),
    createOptionParameter({
      name: "--file",
      type: "TEXT",
      help: `Path to a JSON file containing the ${bodyLabel.toLowerCase()}`,
      conflictsWith: ["--data", "--stdin-json"]
    })
  ];

  if (options?.includeStdinJson ?? true) {
    parameters.push(
      createOptionParameter({
        name: "--stdin-json",
        type: "BOOLEAN",
        help: `Read the ${bodyLabel.toLowerCase()} from stdin`,
        isFlag: true,
        conflictsWith: ["--data", "--file"]
      })
    );
  }

  return parameters;
}

export function createObjectInputSchema(options?: {
  description?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  examples?: unknown[];
}): Record<string, unknown> {
  return {
    type: "object",
    description: options?.description ?? "JSON object body",
    properties: options?.properties ?? {},
    required: options?.required ?? [],
    additionalProperties: options?.additionalProperties ?? true,
    examples: options?.examples ?? []
  };
}
