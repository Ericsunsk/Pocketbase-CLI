import { afterEach, describe, expect, it, vi } from "vitest";

import { createSettingsDefinition } from "../../src/commands/settings";
import { PocketBaseRemoteClient } from "../../src/http/remote-client";
import { buildSubcommand } from "./helpers/command";
import { makeContext } from "./helpers/context";

function buildContext() {
  return makeContext({
    storePath: "/tmp/pocketbase-cli-settings-session.json",
    baseUrl: "https://pb.example.com",
    authed: true
  });
}

describe("settings commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invokes settings.get", async () => {
    const context = buildContext();
    const spy = vi
      .spyOn(PocketBaseRemoteClient.prototype, "settingsGet")
      .mockResolvedValue({ method: "GET", url: "unused", status: 200, data: {} });

    const command = buildSubcommand(createSettingsDefinition(context), "get");

    await command?.parseAsync(["node", "get"]);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("invokes settings.patch with --data body", async () => {
    const context = buildContext();
    const spy = vi
      .spyOn(PocketBaseRemoteClient.prototype, "settingsPatch")
      .mockResolvedValue({ method: "PATCH", url: "unused", status: 200, data: {} });

    const command = buildSubcommand(createSettingsDefinition(context), "patch");

    await command?.parseAsync(["node", "patch", "--data", '{"foo":"bar"}']);
    expect(spy).toHaveBeenCalledWith({ body: { foo: "bar" } });
  });
});
