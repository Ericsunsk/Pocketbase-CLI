import { describe, expect, it, vi } from "vitest";

import { createCli } from "../../src/cli";
import { SessionState, SessionStore } from "../../src/core/session-store";

function createContext() {
  const state = new SessionState();
  state.setRemoteAuth({
    baseUrl: "https://prod.example.com",
    token: "secret-token",
    collection: "_superusers"
  });

  return {
    version: "0.1.0",
    jsonMode: true,
    store: new SessionStore("/tmp/pocketbase-cli-config-test-session.json"),
    state
  };
}

describe("config commands", () => {
  it("clears saved auth when base_url is changed to a different target", async () => {
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
        "config",
        "set",
        "base_url",
        "https://staging.example.com"
      ]);
    } finally {
      vi.restoreAllMocks();
    }

    const payload = JSON.parse(writes.join("").trim()) as {
      message: string;
      data: { auth_cleared: boolean };
    };

    expect(context.state.hasRemoteAuth()).toBe(false);
    expect(payload.message).toBe("Config updated and saved auth cleared");
    expect(payload.data.auth_cleared).toBe(true);
  });
});
