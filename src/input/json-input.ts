import { readFile } from "node:fs/promises";

export function parseJsonObject(raw: string): Record<string, unknown> {
  let payload: unknown;

  try {
    payload = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON body: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("JSON body must be an object");
  }

  return payload as Record<string, unknown>;
}

export async function readStdinText(action: string): Promise<string> {
  const chunks: string[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(String(chunk));
  }

  const raw = chunks.join("");
  if (!raw.trim()) {
    throw new Error(`${action} expected JSON input on stdin.`);
  }

  return raw;
}

export async function readSecretFromStdin(action: string): Promise<string> {
  const raw = await readStdinText(action);
  const value = raw.replace(/[\r\n]+$/u, "");
  if (!value) {
    throw new Error(`${action} expected secret input on stdin.`);
  }

  return value;
}

export async function loadTextInput(options: {
  data?: string;
  filePath?: string;
  stdinJson?: boolean;
  action: string;
  required: boolean;
}): Promise<string | null> {
  const fileIsStdin = options.filePath === "-";
  const explicitFilePath =
    options.filePath && options.filePath !== "-" ? options.filePath : undefined;
  const hasData = options.data !== undefined;
  const hasFile = options.filePath !== undefined;
  const hasStdinJson = Boolean(options.stdinJson);
  const providedSources =
    Number(hasData) +
    Number(hasFile) +
    Number(hasStdinJson);

  if (options.required && providedSources !== 1) {
    throw new Error(
      `${options.action} requires exactly one of \`--data\`, \`--file\`, or \`--stdin-json\`.`
    );
  }

  if (!options.required && providedSources > 1) {
    throw new Error(
      `${options.action} accepts at most one of \`--data\`, \`--file\`, or \`--stdin-json\`.`
    );
  }

  if (providedSources === 0) {
    return null;
  }

  if (options.stdinJson || fileIsStdin) {
    return readStdinText(options.action);
  }

  if (explicitFilePath) {
    try {
      return await readFile(explicitFilePath, "utf8");
    } catch (error) {
      throw new Error(
        `Failed to read JSON file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return options.data ?? "";
}

export async function loadJsonObjectInput(options: {
  data?: string;
  filePath?: string;
  stdinJson?: boolean;
  action: string;
}): Promise<Record<string, unknown>> {
  const raw = await loadTextInput({
    ...options,
    required: true
  });

  return parseJsonObject(raw ?? "");
}

export async function loadOptionalJsonObjectInput(options: {
  data?: string;
  filePath?: string;
  stdinJson?: boolean;
  action: string;
}): Promise<Record<string, unknown> | null> {
  const raw = await loadTextInput({
    ...options,
    required: false
  });

  return raw === null ? null : parseJsonObject(raw);
}
