import { describe, expect, it, vi } from "vitest";

import { createCli } from "../../src/cli";
import { SessionState, SessionStore } from "../../src/core/session-store";

function createContext(options?: {
  baseUrl?: string;
  authBaseUrl?: string;
  authCollection?: string;
}) {
  const state = new SessionState();

  if (options?.baseUrl) {
    state.setConfig("base_url", options.baseUrl);
  }

  if (options?.authBaseUrl) {
    state.setRemoteAuth({
      baseUrl: options.authBaseUrl,
      token: "secret-token",
      collection: options.authCollection ?? "_superusers"
    });
  }

  return {
    version: "0.1.0",
    jsonMode: true,
    suppressHistory: false,
    onStateSaved: undefined,
    store: new SessionStore("/tmp/pocketbase-cli-preflight-test-session.json"),
    state
  };
}

describe("preflight command", () => {
  it("reports missing prerequisites without mutating state", async () => {
    const context = createContext();
    const cli = createCli(context);
    const writes: string[] = [];

    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    });

    try {
      await cli.parseAsync([
        "node",
        "pocketbase-cli",
        "--json",
        "preflight",
        "--require-auth",
        "--skip-health"
      ]);
    } finally {
      vi.restoreAllMocks();
    }

    const payload = JSON.parse(writes.join("").trim()) as {
      message: string;
      result: {
        ready: boolean;
        missing_prerequisites: string[];
        checks: Array<{ name: string; status: string; required: boolean }>;
      };
    };

    expect(payload.message).toBe("Preflight check requires attention");
    expect(payload.result.ready).toBe(false);
    expect(payload.result.missing_prerequisites).toEqual(["base_url", "auth_login"]);
    expect(payload.result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "base_url", status: "fail", required: true }),
        expect.objectContaining({ name: "auth", status: "fail", required: true })
      ])
    );
    expect(context.state.hasRemoteAuth()).toBe(false);
  });

  it("passes when config and saved auth are ready for an authenticated command", async () => {
    const context = createContext({
      baseUrl: "https://pb.example.com",
      authBaseUrl: "https://pb.example.com"
    });
    const cli = createCli(context);
    const writes: string[] = [];

    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    });

    try {
      await cli.parseAsync([
        "node",
        "pocketbase-cli",
        "--json",
        "preflight",
        "--require-auth",
        "--skip-health"
      ]);
    } finally {
      vi.restoreAllMocks();
    }

    const payload = JSON.parse(writes.join("").trim()) as {
      message: string;
      result: {
        ready: boolean;
        checks: Array<{ name: string; status: string }>;
      };
    };

    expect(payload.message).toBe("Preflight check passed");
    expect(payload.result.ready).toBe(true);
    expect(payload.result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "base_url", status: "pass" }),
        expect.objectContaining({ name: "auth", status: "pass" }),
        expect.objectContaining({ name: "health", status: "skip" })
      ])
    );
    expect(context.state.commandHistory.at(-1)).toBe("preflight --require-auth --skip-health");
  });
});
