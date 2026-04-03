import { afterEach, describe, expect, it, vi } from "vitest";

import { createRawDefinition } from "../../src/commands/raw";
import { CliExitError } from "../../src/core/output";
import { makeContext } from "./helpers/context";
import { captureStdout, silenceProcessOutput } from "./helpers/output";

function buildContext(options?: {
  configBaseUrl?: string;
  remoteAuthBaseUrl?: string;
}) {
  return makeContext({
    storePath: "/tmp/pocketbase-cli-raw-session.json",
    jsonMode: true,
    baseUrl: options?.configBaseUrl ?? "https://pb.example.com",
    authed: true,
    authBaseUrl: options?.remoteAuthBaseUrl,
    token: "secret-token"
  });
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

  it("redacts raw history query strings and fragments", async () => {
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

    await command?.parseAsync([
      "node",
      "raw",
      "GET",
      "/probe/path?token=secret-token&expand=profile#section"
    ]);

    expect(context.state.commandHistory.at(-1)).toBe(
      "raw GET /probe/path?<redacted>#<redacted>"
    );
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

  it("redacts tokenized urls in successful raw output", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () =>
        JSON.stringify({
          signedUrl: "https://pb.example.com/api/files/users/rec1/avatar.png?token=file-token"
        })
    });
    vi.stubGlobal("fetch", fetchMock);

    const context = buildContext();
    const command = createRawDefinition(context).build?.();
    const stdout = captureStdout();

    try {
      await command?.parseAsync([
        "node",
        "raw",
        "GET",
        "/probe/path?token=secret-token"
      ]);
    } finally {
      stdout.restore();
    }

    const payload = JSON.parse(stdout.output.join("").trim()) as {
      data: {
        url: string;
      };
      result: {
        signedUrl: string;
      };
    };

    expect(payload.data.url).toContain("token=********");
    expect(payload.result.signedUrl).toContain("token=********");
  });
});
