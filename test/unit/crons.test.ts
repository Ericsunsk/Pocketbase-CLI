import { afterEach, describe, expect, it, vi } from "vitest";

import { createCronsDefinition } from "../../src/commands/crons";
import { CliExitError } from "../../src/core/output";
import { PocketBaseRemoteClient } from "../../src/http/remote-client";
import { buildSubcommand } from "./helpers/command";
import { makeContext } from "./helpers/context";

function buildContext() {
  return makeContext({
    storePath: "/tmp/pocketbase-cli-crons-session.json",
    baseUrl: "https://pb.example.com",
    authed: true
  });
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

    const command = buildSubcommand(createCronsDefinition(context), "list");

    await command?.parseAsync(["node", "list"]);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("requires --yes before running a cron", async () => {
    const context = buildContext();
    const command = buildSubcommand(createCronsDefinition(context), "run");

    await expect(command?.parseAsync(["node", "run", "job-id"])).rejects.toBeInstanceOf(CliExitError);
  });

  it("runs cron job when --yes is present", async () => {
    const context = buildContext();
    const spy = vi
      .spyOn(PocketBaseRemoteClient.prototype, "cronsRun")
      .mockResolvedValue({ method: "POST", url: "/api/crons/job-id", status: 200, data: {} });

    const command = buildSubcommand(createCronsDefinition(context), "run");

    await command?.parseAsync(["node", "run", "job-id", "--yes"]);
    expect(spy).toHaveBeenCalledWith("job-id");
  });
});
