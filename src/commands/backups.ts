import { createWriteStream } from "node:fs";
import { access, chmod, mkdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import { Command } from "commander";

import { AppContext, recordCommand } from "../app/context";
import type { CommandDefinition } from "../contract/command-registry";
import { emitError, emitSuccess } from "../core/output";
import { PocketBaseRemoteError } from "../http/remote-client";
import { buildRemoteClient, handleRemoteError, requireConfirmation, resolveFileToken, runRemoteAction } from "./support";

function redactCommand(parts: string[], sensitiveIndexes?: Set<number>): string {
  if (!sensitiveIndexes || sensitiveIndexes.size === 0) {
    return parts.join(" ");
  }

  return parts
    .map((part, index) => (sensitiveIndexes.has(index) ? "********" : part))
    .join(" ");
}

async function ensureUploadSource(filePath: string): Promise<{ size: number }> {
  let fileStats;
  try {
    fileStats = await stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Backup file does not exist: ${filePath}`);
    }

    throw error;
  }

  if (!fileStats.isFile()) {
    throw new Error(`Backup upload path is not a file: ${filePath}`);
  }

  return {
    size: fileStats.size
  };
}

async function writePrivateFileStreamAtomic(
  path: string,
  stream: ReadableStream<Uint8Array>
): Promise<number> {
  await mkdir(dirname(path), { recursive: true });

  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  const input = Readable.fromWeb(stream as unknown as NodeReadableStream<Uint8Array>);
  let size = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback): void {
      size += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
      callback(null, chunk);
    }
  });

  try {
    await pipeline(input, counter, createWriteStream(tempPath, { mode: 0o600 }));
    await rename(tempPath, path);
    await chmod(path, 0o600);
    return size;
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

export function createBackupsDefinition(context: AppContext): CommandDefinition {
  return {
    name: "backups",
    path: "backups",
    kind: "group",
    summary: "Remote backup endpoints",
    authRequired: true,
    destructive: false,
    confirmationRequired: false,
    children: [
      {
        name: "list",
        path: "backups.list",
        kind: "command",
        summary: "List backup archives",
        authRequired: true,
        destructive: false,
        confirmationRequired: false,
        examples: ["pocketbase-cli --json backups list"],
        build: () =>
          new Command("list")
            .description("List backup archives")
            .action(async () => {
              await recordCommand(context, "backups list");
              await runRemoteAction(context, {
                action: "backups.list",
                successMessage: "Backups list completed",
                operation: (client) => client.backupsList()
              });
            })
      },
      {
        name: "create",
        path: "backups.create",
        kind: "command",
        summary: "Create a new backup archive",
        authRequired: true,
        destructive: false,
        confirmationRequired: false,
        parameters: [
          {
            kind: "option",
            name: "--name",
            names: ["--name"],
            required: false,
            takes_value: true,
            is_flag: false,
            nargs: 1,
            type: "TEXT",
            help: "Optional backup archive name, for example snapshot.zip"
          }
        ],
        examples: ["pocketbase-cli --json backups create --name snapshot.zip"],
        build: () =>
          new Command("create")
            .description("Create a new backup archive")
            .option("--name <name>", "Optional backup archive name, for example snapshot.zip")
            .action(async (options: { name?: string }) => {
              const historyParts = ["backups", "create"];
              if (options.name) {
                historyParts.push("--name", options.name);
              }
              await recordCommand(context, historyParts.join(" "));
              await runRemoteAction(context, {
                action: "backups.create",
                successMessage: "Backup create completed",
                operation: (client) =>
                  client.backupsCreate({
                    name: options.name ?? null
                  })
              });
            })
      },
      {
        name: "upload",
        path: "backups.upload",
        kind: "command",
        summary: "Upload a backup archive",
        authRequired: true,
        destructive: false,
        confirmationRequired: false,
        parameters: [
          {
            kind: "argument",
            name: "file_path",
            required: true,
            nargs: 1,
            type: "TEXT",
            help: "Path to the backup .zip archive to upload"
          }
        ],
        examples: ["pocketbase-cli --json backups upload ./pb_backup_20240101.zip"],
        build: () =>
          new Command("upload")
            .description("Upload a backup archive")
            .argument("<file_path>")
            .action(async (filePath: string) => {
              await recordCommand(context, `backups upload ${filePath}`);

              let fileSize: number;
              try {
                ({ size: fileSize } = await ensureUploadSource(filePath));
              } catch (error) {
                emitError({
                  jsonOutput: context.jsonMode,
                  action: "backups.upload",
                  message: error instanceof Error ? error.message : String(error)
                });
              }

              const client = buildRemoteClient(context, {
                action: "backups.upload",
                requireAuth: true
              });

              try {
                const result = await client.backupsUpload({ filePath });
                emitSuccess({
                  jsonOutput: context.jsonMode,
                  action: "backups.upload",
                  message: "Backup upload completed",
                  data: {
                    url: result.url,
                    status: result.status,
                    path: filePath,
                    name: basename(filePath),
                    size: fileSize
                  }
                });
              } catch (error) {
                if (error instanceof PocketBaseRemoteError) {
                  handleRemoteError(context, "backups.upload", error);
                }

                emitError({
                  jsonOutput: context.jsonMode,
                  action: "backups.upload",
                  message: `Failed to read backup file: ${error instanceof Error ? error.message : String(error)}`
                });
              }
            })
      },
      {
        name: "delete",
        path: "backups.delete",
        kind: "command",
        summary: "Delete a backup archive",
        authRequired: true,
        destructive: true,
        confirmationRequired: true,
        confirmationFlag: "--yes",
        examples: ["pocketbase-cli --json backups delete pb_backup_20240101.zip --yes"],
        parameters: [
          {
            kind: "argument",
            name: "name",
            required: true,
            nargs: 1,
            type: "TEXT",
            help: "Backup archive filename, for example pb_backup_20240101.zip"
          },
          {
            kind: "option",
            name: "--yes",
            names: ["--yes"],
            required: false,
            takes_value: false,
            is_flag: true,
            nargs: 1,
            type: "BOOLEAN",
            help: "Acknowledge that deleting a backup archive is destructive"
          }
        ],
        build: () =>
          new Command("delete")
            .description("Delete a backup archive")
            .argument("<name>")
            .option("--yes", "Acknowledge that deleting a backup archive is destructive")
            .action(async (name: string, options: { yes?: boolean }) => {
              requireConfirmation(context, {
                action: "backups.delete",
                yes: Boolean(options.yes),
                message: "Backup delete is destructive. Re-run with `--yes` to continue.",
                hint:
                  "Re-run `backups delete <name> --yes` after confirming the archive should be removed."
              });

              await recordCommand(context, `backups delete ${name} --yes`);
              await runRemoteAction(context, {
                action: "backups.delete",
                successMessage: "Backup delete completed",
                operation: (client) => client.backupsDelete(name)
              });
            })
      },
      {
        name: "download",
        path: "backups.download",
        kind: "command",
        summary: "Download a backup archive",
        authRequired: true,
        destructive: false,
        confirmationRequired: false,
        examples: [
          "pocketbase-cli --json backups download pb_backup_20240101.zip",
          "pocketbase-cli --json backups download pb_backup_20240101.zip --output ./my-backup.zip --overwrite"
        ],
        parameters: [
          {
            kind: "argument",
            name: "name",
            required: true,
            nargs: 1,
            type: "TEXT",
            help: "Backup archive filename, for example pb_backup_20240101.zip"
          },
          {
            kind: "option",
            name: "--output",
            names: ["--output"],
            required: false,
            takes_value: true,
            is_flag: false,
            nargs: 1,
            type: "TEXT",
            help: "Destination file path. Defaults to ./<name>"
          },
          {
            kind: "option",
            name: "--token",
            names: ["--token"],
            required: false,
            takes_value: true,
            is_flag: false,
            nargs: 1,
            type: "TEXT",
            help: "Optional backup file token. If omitted the CLI will fetch one automatically",
            sensitive: true
          },
          {
            kind: "option",
            name: "--overwrite",
            names: ["--overwrite"],
            required: false,
            takes_value: false,
            is_flag: true,
            nargs: 1,
            type: "BOOLEAN",
            help: "Overwrite the destination file if it already exists"
          }
        ],
        build: () =>
          new Command("download")
            .description("Download a backup archive")
            .argument("<name>")
            .option("--output <path>", "Destination file path. Defaults to ./<name>")
            .option(
              "--token <token>",
              "Optional backup file token. If omitted the CLI will fetch one automatically."
            )
            .option("--overwrite", "Overwrite the destination file if it already exists")
            .action(
              async (
                name: string,
                options: {
                  output?: string;
                  token?: string;
                  overwrite?: boolean;
                }
              ) => {
                const historyParts = ["backups", "download", name];
                if (options.output) {
                  historyParts.push("--output", options.output);
                }
                if (options.overwrite) {
                  historyParts.push("--overwrite");
                }
                const sensitiveIndexes = new Set<number>();
                if (options.token) {
                  historyParts.push("--token", options.token);
                  sensitiveIndexes.add(historyParts.length - 1);
                }
                await recordCommand(
                  context,
                  redactCommand(historyParts, sensitiveIndexes.size > 0 ? sensitiveIndexes : undefined)
                );

                const targetPath = options.output ?? join(process.cwd(), basename(name));
                if (!options.overwrite) {
                  try {
                    await access(targetPath);
                    emitError({
                      jsonOutput: context.jsonMode,
                      action: "backups.download",
                      message: `Output file already exists: ${targetPath}. Pass \`--overwrite\` to replace it.`
                    });
                  } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                      throw error;
                    }
                  }
                }

                const client = buildRemoteClient(context, {
                  action: "backups.download",
                  requireAuth: true
                });

                const resolvedToken =
                  options.token ??
                  (await resolveFileToken(context, {
                    action: "backups.download",
                    client
                  }));

                try {
                  const result = await client.backupsDownload({
                    name,
                    token: resolvedToken
                  });
                  const size = await writePrivateFileStreamAtomic(targetPath, result.data);

                  emitSuccess({
                    jsonOutput: context.jsonMode,
                    action: "backups.download",
                    message: "Backup download completed",
                    data: {
                      status: result.status,
                      path: targetPath,
                      size,
                      name
                    }
                  });
                } catch (error) {
                  if (error instanceof PocketBaseRemoteError) {
                    handleRemoteError(context, "backups.download", error);
                  }

                  emitError({
                    jsonOutput: context.jsonMode,
                    action: "backups.download",
                    message: `Failed to write backup file: ${error instanceof Error ? error.message : String(error)}`
                  });
                }
              }
            )
      },
      {
        name: "restore",
        path: "backups.restore",
        kind: "command",
        summary: "Restore a backup archive",
        authRequired: true,
        destructive: true,
        confirmationRequired: true,
        confirmationFlag: "--yes",
        examples: ["pocketbase-cli --json backups restore pb_backup_20240101.zip --yes"],
        notes: ["Restoring a backup replaces all current data and restarts the PocketBase application."],
        parameters: [
          {
            kind: "argument",
            name: "name",
            required: true,
            nargs: 1,
            type: "TEXT",
            help: "Backup archive filename to restore"
          },
          {
            kind: "option",
            name: "--yes",
            names: ["--yes"],
            required: false,
            takes_value: false,
            is_flag: true,
            nargs: 1,
            type: "BOOLEAN",
            help: "Acknowledge that restore is destructive and restarts the app"
          }
        ],
        build: () =>
          new Command("restore")
            .description("Restore a backup archive")
            .argument("<name>")
            .option("--yes", "Acknowledge that restore is destructive and restarts the app")
            .action(async (name: string, options: { yes?: boolean }) => {
              requireConfirmation(context, {
                action: "backups.restore",
                yes: Boolean(options.yes),
                message: "Backup restore is destructive. Re-run with `--yes` to continue.",
                hint:
                  "Re-run `backups restore <name> --yes` after confirming the remote app can be restarted."
              });

              await recordCommand(context, `backups restore ${name} --yes`);
              await runRemoteAction(context, {
                action: "backups.restore",
                successMessage: "Backup restore started",
                operation: (client) => client.backupsRestore(name)
              });
            })
      }
    ],
    build: () => new Command("backups").description("Remote backup endpoints")
  };
}
