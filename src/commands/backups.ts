import { access, mkdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

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
            type: "TEXT"
          }
        ],
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
            type: "TEXT"
          }
        ],
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
        parameters: [
          {
            kind: "argument",
            name: "name",
            required: true,
            nargs: 1,
            type: "TEXT"
          },
          {
            kind: "option",
            name: "--yes",
            names: ["--yes"],
            required: false,
            takes_value: false,
            is_flag: true,
            nargs: 1,
            type: "BOOLEAN"
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
        parameters: [
          {
            kind: "argument",
            name: "name",
            required: true,
            nargs: 1,
            type: "TEXT"
          },
          {
            kind: "option",
            name: "--output",
            names: ["--output"],
            required: false,
            takes_value: true,
            is_flag: false,
            nargs: 1,
            type: "TEXT"
          },
          {
            kind: "option",
            name: "--token",
            names: ["--token"],
            required: false,
            takes_value: true,
            is_flag: false,
            nargs: 1,
            type: "TEXT"
          },
          {
            kind: "option",
            name: "--overwrite",
            names: ["--overwrite"],
            required: false,
            takes_value: false,
            is_flag: true,
            nargs: 1,
            type: "BOOLEAN"
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

                  await mkdir(dirname(targetPath), {
                    recursive: true
                  });
                  await writeFile(targetPath, result.data);

                  emitSuccess({
                    jsonOutput: context.jsonMode,
                    action: "backups.download",
                    message: "Backup download completed",
                    data: {
                      url: result.url,
                      status: result.status,
                      path: targetPath,
                      size: result.data.byteLength,
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
        parameters: [
          {
            kind: "argument",
            name: "name",
            required: true,
            nargs: 1,
            type: "TEXT"
          },
          {
            kind: "option",
            name: "--yes",
            names: ["--yes"],
            required: false,
            takes_value: false,
            is_flag: true,
            nargs: 1,
            type: "BOOLEAN"
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
