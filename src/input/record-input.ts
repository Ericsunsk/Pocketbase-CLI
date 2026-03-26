import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { loadOptionalJsonObjectInput } from "./json-input";

export interface RecordBinaryFileInput {
  fieldName: string;
  filePath: string;
}

function expandHomePath(filePath: string): string {
  if (filePath === "~") {
    return homedir();
  }

  if (filePath.startsWith("~/")) {
    return join(homedir(), filePath.slice(2));
  }

  return filePath;
}

export async function parseBinaryFileInputs(options: {
  binaryFiles: string[];
  action: string;
}): Promise<RecordBinaryFileInput[]> {
  const parsed: RecordBinaryFileInput[] = [];

  for (const item of options.binaryFiles) {
    if (!item.includes("=")) {
      throw new Error(
        `${options.action} expected \`--binary-file\` in \`<field>=<path>\` format.`
      );
    }

    const [fieldNameRaw, pathRaw] = item.split("=", 2);
    const fieldName = fieldNameRaw.trim();
    const pathValue = pathRaw.trim();

    if (!fieldName) {
      throw new Error(
        `${options.action} expected \`--binary-file\` field name in \`<field>=<path>\` format.`
      );
    }

    if (!pathValue) {
      throw new Error(
        `${options.action} expected \`--binary-file\` path in \`<field>=<path>\` format.`
      );
    }

    const filePath = expandHomePath(pathValue);

    let stats;
    try {
      stats = await stat(filePath);
    } catch {
      throw new Error(`${options.action} binary file does not exist: ${filePath}`);
    }

    if (!stats.isFile()) {
      throw new Error(`${options.action} binary upload path is not a file: ${filePath}`);
    }

    parsed.push({
      fieldName,
      filePath
    });
  }

  return parsed;
}

export async function loadRecordMutationInput(options: {
  data?: string;
  filePath?: string;
  stdinJson?: boolean;
  binaryFiles: string[];
  action: string;
}): Promise<{
  body: Record<string, unknown>;
  binaryFiles: RecordBinaryFileInput[];
}> {
  const body = await loadOptionalJsonObjectInput({
    data: options.data,
    filePath: options.filePath,
    stdinJson: options.stdinJson,
    action: options.action
  });
  const binaryFiles = await parseBinaryFileInputs({
    binaryFiles: options.binaryFiles,
    action: options.action
  });

  if (body === null && binaryFiles.length === 0) {
    throw new Error(
      `${options.action} requires JSON input (\`--data\`, \`--file\`, \`--stdin-json\`) or at least one \`--binary-file\`.`
    );
  }

  return {
    body: body ?? {},
    binaryFiles
  };
}
