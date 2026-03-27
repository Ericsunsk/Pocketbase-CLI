import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogsDefinition } from "../../src/commands/logs";
import { CliExitError } from "../../src/core/output";
import { PocketBaseRemoteClient } from "../../src/http/remote-client";
import { SessionState, SessionStore } from "../../src/core/session-store";

function buildContext() {
  const store = new SessionStore("/tmp/pocketbase-cli-logs-session.json");
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

describe("logs commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls logs.list with query args", async () => {
    const context = buildContext();
    const spy = vi
      .spyOn(PocketBaseRemoteClient.prototype, "logsList")
      .mockResolvedValue({ method: "GET", url: "/api/logs", status: 200, data: { items: [] } });

    const definition = createLogsDefinition(context);
    const listDefinition = definition.children?.find((child) => child.name === "list");
    const command = listDefinition?.build?.();

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

    const definition = createLogsDefinition(context);
    const getDefinition = definition.children?.find((child) => child.name === "get");
    const command = getDefinition?.build?.();

    await command?.parseAsync(["node", "get", "log123"]);
    expect(spy).toHaveBeenCalledWith("log123");
  });

  it("rejects non-integer pagination values", async () => {
    const context = buildContext();
    const spy = vi.spyOn(PocketBaseRemoteClient.prototype, "logsList");

    const definition = createLogsDefinition(context);
    const listDefinition = definition.children?.find((child) => child.name === "list");
    const command = listDefinition?.build?.();

    await expect(
      command?.parseAsync(["node", "list", "--per-page", "1.5"])
    ).rejects.toBeInstanceOf(CliExitError);

    expect(spy).not.toHaveBeenCalled();
  });
});
