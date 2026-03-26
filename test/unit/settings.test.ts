import { afterEach, describe, expect, it, vi } from "vitest";

import { createSettingsDefinition } from "../../src/commands/settings";
import { PocketBaseRemoteClient } from "../../src/http/remote-client";
import { SessionState, SessionStore } from "../../src/core/session-store";

function buildContext() {
  const store = new SessionStore("/tmp/pocketbase-cli-settings-session.json");
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

describe("settings commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invokes settings.get", async () => {
    const context = buildContext();
    const spy = vi
      .spyOn(PocketBaseRemoteClient.prototype, "settingsGet")
      .mockResolvedValue({ method: "GET", url: "unused", status: 200, data: {} });

    const definition = createSettingsDefinition(context);
    const getDefinition = definition.children?.find((child) => child.name === "get");
    const command = getDefinition?.build?.();

    await command?.parseAsync(["node", "get"]);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("invokes settings.patch with --data body", async () => {
    const context = buildContext();
    const spy = vi
      .spyOn(PocketBaseRemoteClient.prototype, "settingsPatch")
      .mockResolvedValue({ method: "PATCH", url: "unused", status: 200, data: {} });

    const definition = createSettingsDefinition(context);
    const patchDefinition = definition.children?.find((child) => child.name === "patch");
    const command = patchDefinition?.build?.();

    await command?.parseAsync(["node", "patch", "--data", '{"foo":"bar"}']);
    expect(spy).toHaveBeenCalledWith({ body: { foo: "bar" } });
  });
});
