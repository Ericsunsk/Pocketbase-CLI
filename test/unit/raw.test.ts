import { afterEach, describe, expect, it, vi } from "vitest";

import { createRawDefinition } from "../../src/commands/raw";
import { CliExitError } from "../../src/core/output";
import { SessionState, SessionStore } from "../../src/core/session-store";

function buildContext(options?: {
  configBaseUrl?: string;
  remoteAuthBaseUrl?: string;
}) {
  const store = new SessionStore("/tmp/pocketbase-cli-raw-session.json");
  const state = new SessionState();

  if (options?.configBaseUrl !== undefined) {
    state.setConfig("base_url", options.configBaseUrl);
  } else {
    state.setConfig("base_url", "https://pb.example.com");
  }

  state.setRemoteAuth({
    baseUrl: options?.remoteAuthBaseUrl ?? "https://pb.example.com",
    token: "secret-token"
  });

  return {
    version: "0.1.0",
    jsonMode: true,
    store,
    state
  };
}

function silenceProcessOutput(): void {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
}

describe("raw command", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps anonymous requests anonymous by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ ok: true })
    });
    vi.stubGlobal("fetch", fetchMock);
    silenceProcessOutput();

    const context = buildContext();
    const command = createRawDefinition(context).build?.();

    await command?.parseAsync(["node", "raw", "GET", "/probe"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.not.objectContaining({
        Authorization: "secret-token"
      })
    });
  });

  it("attaches saved auth only when --with-auth is passed", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ ok: true })
    });
    vi.stubGlobal("fetch", fetchMock);
    silenceProcessOutput();

    const context = buildContext();
    const command = createRawDefinition(context).build?.();

    await command?.parseAsync(["node", "raw", "GET", "/probe", "--with-auth"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        Authorization: "secret-token"
      })
    });
    expect(context.state.commandHistory.at(-1)).toBe("raw GET /probe --with-auth");
  });

  it("rejects --with-auth when saved auth targets a different base URL", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    silenceProcessOutput();

    const context = buildContext({
      configBaseUrl: "https://staging.example.com",
      remoteAuthBaseUrl: "https://prod.example.com"
    });
    const command = createRawDefinition(context).build?.();

    await expect(
      command?.parseAsync(["node", "raw", "GET", "/probe", "--with-auth"])
    ).rejects.toBeInstanceOf(CliExitError);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
