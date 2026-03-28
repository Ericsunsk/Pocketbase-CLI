import { afterEach, describe, expect, it, vi } from "vitest";

import { createFilesDefinition } from "../../src/commands/files";
import { CliExitError } from "../../src/core/output";
import { PocketBaseRemoteClient } from "../../src/http/remote-client";
import { buildSubcommand } from "./helpers/command";
import { makeContext } from "./helpers/context";

function buildContext() {
  return makeContext({
    storePath: "/tmp/pocketbase-cli-files-session.json",
    baseUrl: "https://pb.example.com",
    authed: true
  });
}

describe("files commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redacts explicit file token from history", async () => {
    const context = buildContext();
    const spy = vi.spyOn(PocketBaseRemoteClient.prototype, "filesToken");

    const command = buildSubcommand(createFilesDefinition(context), "url");

    await command?.parseAsync([
      "node",
      "url",
      "users",
      "rec1",
      "avatar.png",
      "--token",
      "secret-token"
    ]);

    expect(context.state.commandHistory.at(-1)).toBe(
      "files url users rec1 avatar.png --token ********"
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("fetches a temporary token when --with-token is set", async () => {
    const context = buildContext();
    const spy = vi.spyOn(PocketBaseRemoteClient.prototype, "filesToken").mockResolvedValue({
      method: "POST",
      url: "/api/files/token",
      status: 200,
      data: {
        token: "generated-token"
      }
    });

    const command = buildSubcommand(createFilesDefinition(context), "url");

    await command?.parseAsync(["node", "url", "users", "rec1", "avatar.png", "--with-token"]);

    expect(spy).toHaveBeenCalledOnce();
    expect(context.state.commandHistory.at(-1)).toBe(
      "files url users rec1 avatar.png --with-token"
    );
  });

  it("rejects combining --token and --with-token", async () => {
    const context = buildContext();
    const command = buildSubcommand(createFilesDefinition(context), "url");

    await expect(
      command?.parseAsync([
        "node",
        "url",
        "users",
        "rec1",
        "avatar.png",
        "--token",
        "secret-token",
        "--with-token"
      ])
    ).rejects.toBeInstanceOf(CliExitError);
  });
});
