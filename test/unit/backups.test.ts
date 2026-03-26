import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createBackupsDefinition } from "../../src/commands/backups";
import { CliExitError } from "../../src/core/output";
import { PocketBaseRemoteClient } from "../../src/http/remote-client";
import { SessionState, SessionStore } from "../../src/core/session-store";

function buildContext() {
  const store = new SessionStore("/tmp/pocketbase-cli-backups-session.json");
  const state = new SessionState();
  state.setConfig("base_url", "https://pb.example.com");
  state.setRemoteAuth({
    baseUrl: "https://pb.example.com/",
    token: "token"
  });

  return {
    version: "0.1.0",
    jsonMode: false,
    store,
    state
  };
}

async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pocketbase-cli-backups-"));
}

describe("backups commands", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("uploads a local backup archive", async () => {
    const context = buildContext();
    const tempDir = await createTempDir();
    tempDirs.push(tempDir);
    const archivePath = join(tempDir, "snapshot.zip");
    await writeFile(archivePath, new Uint8Array([1, 2, 3]));

    const spy = vi.spyOn(PocketBaseRemoteClient.prototype, "backupsUpload").mockResolvedValue({
      method: "POST",
      url: "/api/backups/upload",
      status: 200,
      data: {}
    });

    const definition = createBackupsDefinition(context);
    const uploadDefinition = definition.children?.find((child) => child.name === "upload");
    const command = uploadDefinition?.build?.();

    await command?.parseAsync(["node", "upload", archivePath]);

    expect(spy).toHaveBeenCalledWith({
      filePath: archivePath
    });
  });

  it("downloads a backup archive and writes it to disk", async () => {
    const context = buildContext();
    const tempDir = await createTempDir();
    tempDirs.push(tempDir);
    const outputPath = join(tempDir, "downloads", "snapshot.zip");

    const tokenSpy = vi.spyOn(PocketBaseRemoteClient.prototype, "filesToken").mockResolvedValue({
      method: "POST",
      url: "/api/files/token",
      status: 200,
      data: {
        token: "generated-token"
      }
    });
    const downloadSpy = vi
      .spyOn(PocketBaseRemoteClient.prototype, "backupsDownload")
      .mockResolvedValue({
        method: "GET",
        url: "/api/backups/snapshot.zip?token=generated-token",
        status: 200,
        data: new Uint8Array([7, 8, 9])
      });

    const definition = createBackupsDefinition(context);
    const downloadDefinition = definition.children?.find((child) => child.name === "download");
    const command = downloadDefinition?.build?.();

    await command?.parseAsync(["node", "download", "snapshot.zip", "--output", outputPath]);

    expect(tokenSpy).toHaveBeenCalledOnce();
    expect(downloadSpy).toHaveBeenCalledWith({
      name: "snapshot.zip",
      token: "generated-token"
    });
    expect(Array.from(await readFile(outputPath))).toEqual([7, 8, 9]);
  });

  it("protects existing download output unless --overwrite is passed", async () => {
    const context = buildContext();
    const tempDir = await createTempDir();
    tempDirs.push(tempDir);
    const outputPath = join(tempDir, "snapshot.zip");
    await writeFile(outputPath, "existing");

    const downloadSpy = vi.spyOn(PocketBaseRemoteClient.prototype, "backupsDownload");

    const definition = createBackupsDefinition(context);
    const downloadDefinition = definition.children?.find((child) => child.name === "download");
    const command = downloadDefinition?.build?.();

    await expect(
      command?.parseAsync(["node", "download", "snapshot.zip", "--output", outputPath])
    ).rejects.toBeInstanceOf(CliExitError);

    expect(downloadSpy).not.toHaveBeenCalled();
  });

  it("requires --yes before deleting a backup", async () => {
    const context = buildContext();
    const definition = createBackupsDefinition(context);
    const deleteDefinition = definition.children?.find((child) => child.name === "delete");
    const command = deleteDefinition?.build?.();

    await expect(command?.parseAsync(["node", "delete", "snapshot.zip"])).rejects.toBeInstanceOf(
      CliExitError
    );
  });
});
