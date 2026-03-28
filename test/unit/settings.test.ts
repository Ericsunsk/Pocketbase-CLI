import { afterEach, describe, expect, it, vi } from "vitest";

import { createSettingsDefinition } from "../../src/commands/settings";
import { PocketBaseRemoteClient } from "../../src/http/remote-client";
import { buildSubcommand } from "./helpers/command";
import { makeContext } from "./helpers/context";
import { captureStdout } from "./helpers/output";

function buildContext(options?: { jsonMode?: boolean }) {
  return makeContext({
    storePath: "/tmp/pocketbase-cli-settings-session.json",
    baseUrl: "https://pb.example.com",
    authed: true,
    jsonMode: options?.jsonMode ?? false
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

  it("redacts sensitive fields from settings.get output", async () => {
    const context = buildContext({ jsonMode: true });
    const stdout = captureStdout();
    vi.spyOn(PocketBaseRemoteClient.prototype, "settingsGet").mockResolvedValue({
      method: "GET",
      url: "unused?token=secret-token",
      status: 200,
      data: {
        smtpPassword: "Secret123",
        storage: {
          secretAccessKey: "abc123"
        }
      }
    });

    const command = buildSubcommand(createSettingsDefinition(context), "get");

    try {
      await command?.parseAsync(["node", "get"]);
    } finally {
      stdout.restore();
    }

    const rendered = stdout.output.join("").trim();
    const payload = JSON.parse(rendered) as {
      data: {
        url: string;
        data: {
          smtpPassword: string;
          storage: {
            secretAccessKey: string;
          };
        };
      };
    };

    expect(rendered).not.toContain("Secret123");
    expect(rendered).not.toContain("abc123");
    expect(payload.data.url).toContain("token=********");
    expect(payload.data.data.smtpPassword).toBe("********");
    expect(payload.data.data.storage.secretAccessKey).toBe("********");
  });
});
