import { afterEach, describe, expect, it, vi } from "vitest";

import { createFilesDefinition } from "../../src/commands/files";
import { CliExitError } from "../../src/core/output";
import { PocketBaseRemoteClient } from "../../src/http/remote-client";
import { SessionState, SessionStore } from "../../src/core/session-store";

function buildContext() {
  const store = new SessionStore("/tmp/pocketbase-cli-files-session.json");
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

describe("files commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redacts explicit file token from history", async () => {
    const context = buildContext();
    const spy = vi.spyOn(PocketBaseRemoteClient.prototype, "filesToken");

    const definition = createFilesDefinition(context);
    const urlDefinition = definition.children?.find((child) => child.name === "url");
    const command = urlDefinition?.build?.();

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

    const definition = createFilesDefinition(context);
    const urlDefinition = definition.children?.find((child) => child.name === "url");
    const command = urlDefinition?.build?.();

    await command?.parseAsync(["node", "url", "users", "rec1", "avatar.png", "--with-token"]);

    expect(spy).toHaveBeenCalledOnce();
    expect(context.state.commandHistory.at(-1)).toBe(
      "files url users rec1 avatar.png --with-token"
    );
  });

  it("rejects combining --token and --with-token", async () => {
    const context = buildContext();
    const definition = createFilesDefinition(context);
    const urlDefinition = definition.children?.find((child) => child.name === "url");
    const command = urlDefinition?.build?.();

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
