import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogsDefinition } from "../../src/commands/logs";
import { CliExitError } from "../../src/core/output";
import { PocketBaseRemoteClient } from "../../src/http/remote-client";
import { buildSubcommand } from "./helpers/command";
import { makeContext } from "./helpers/context";

function buildContext() {
  return makeContext({
    storePath: "/tmp/pocketbase-cli-logs-session.json",
    baseUrl: "https://pb.example.com",
    authed: true
  });
}

describe("logs commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls logs.list with query args", async () => {
    const context = buildContext();
    const spy = vi
      .spyOn(PocketBaseRemoteClient.prototype, "logsList")
      .mockResolvedValue({ method: "GET", url: "/api/logs", status: 200, data: { items: [] } });

    const command = buildSubcommand(createLogsDefinition(context), "list");

    await command?.parseAsync([
      "node",
      "list",
      "--page",
      "2",
      "--per-page",
      "5",
      "--filter",
      "level>200",
      "--sort",
      "created"
    ]);

    expect(spy).toHaveBeenCalledWith({
      page: 2,
      perPage: 5,
      filterValue: "level>200",
      sort: "created"
    });
  });

  it("calls logs.get with log id", async () => {
    const context = buildContext();
    const spy = vi
      .spyOn(PocketBaseRemoteClient.prototype, "logsGet")
      .mockResolvedValue({ method: "GET", url: "/api/logs/abc", status: 200, data: {} });

    const command = buildSubcommand(createLogsDefinition(context), "get");

    await command?.parseAsync(["node", "get", "log123"]);
    expect(spy).toHaveBeenCalledWith("log123");
  });

  it("rejects non-integer pagination values", async () => {
    const context = buildContext();
    const spy = vi.spyOn(PocketBaseRemoteClient.prototype, "logsList");

    const command = buildSubcommand(createLogsDefinition(context), "list");

    await expect(
      command?.parseAsync(["node", "list", "--per-page", "1.5"])
    ).rejects.toBeInstanceOf(CliExitError);

    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects negative pagination values", async () => {
    const context = buildContext();
    const spy = vi.spyOn(PocketBaseRemoteClient.prototype, "logsList");

    const command = buildSubcommand(createLogsDefinition(context), "list");

    await expect(
      command?.parseAsync(["node", "list", "--page", "-1"])
    ).rejects.toBeInstanceOf(CliExitError);

    expect(spy).not.toHaveBeenCalled();
  });
});
