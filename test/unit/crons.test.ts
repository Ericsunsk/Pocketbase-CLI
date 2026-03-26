import { afterEach, describe, expect, it, vi } from "vitest";

import { createCronsDefinition } from "../../src/commands/crons";
import { CliExitError } from "../../src/core/output";
import { PocketBaseRemoteClient } from "../../src/http/remote-client";
import { SessionState, SessionStore } from "../../src/core/session-store";

function buildContext() {
  const store = new SessionStore("/tmp/pocketbase-cli-crons-session.json");
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

describe("crons commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists cron jobs", async () => {
    const context = buildContext();
    const spy = vi
      .spyOn(PocketBaseRemoteClient.prototype, "cronsList")
      .mockResolvedValue({ method: "GET", url: "/api/crons", status: 200, data: {} });

    const definition = createCronsDefinition(context);
    const listDefinition = definition.children?.find((child) => child.name === "list");
    const command = listDefinition?.build?.();

    await command?.parseAsync(["node", "list"]);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("requires --yes before running a cron", async () => {
    const context = buildContext();
    const definition = createCronsDefinition(context);
    const runDefinition = definition.children?.find((child) => child.name === "run");
    const command = runDefinition?.build?.();

    await expect(command?.parseAsync(["node", "run", "job-id"])).rejects.toBeInstanceOf(CliExitError);
  });

  it("runs cron job when --yes is present", async () => {
    const context = buildContext();
    const spy = vi
      .spyOn(PocketBaseRemoteClient.prototype, "cronsRun")
      .mockResolvedValue({ method: "POST", url: "/api/crons/job-id", status: 200, data: {} });

    const definition = createCronsDefinition(context);
    const runDefinition = definition.children?.find((child) => child.name === "run");
    const command = runDefinition?.build?.();

    await command?.parseAsync(["node", "run", "job-id", "--yes"]);
    expect(spy).toHaveBeenCalledWith("job-id");
  });
});
