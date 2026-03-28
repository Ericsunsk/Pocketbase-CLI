import { describe, expect, it } from "vitest";

import type { AppContext } from "../../src/app/context";
import { createAppContext, resolveAuthCollection, resolveBaseUrl } from "../../src/app/context";
import { SessionState, SessionStore } from "../../src/core/session-store";
import { CLI_VERSION } from "../../src/core/version";

function createContext(): AppContext {
  return {
    version: "0.1.0",
    jsonMode: true,
    store: new SessionStore("/tmp/pocketbase-cli-context-test-session.json"),
    state: new SessionState()
  };
}

describe("context resolution", () => {
  it("prefers configured base URL and auth collection over env config and stale remote auth state", () => {
    const context = createContext();
    context.state.setConfig("base_url", "https://staging.example.com");
    context.state.setConfig("auth_collection", "admins");
    context.envConfig = {
      base_url: "https://env.example.com"
    };
    context.state.setRemoteAuth({
      baseUrl: "https://prod.example.com",
      token: "secret-token",
      collection: "_superusers"
    });

    expect(resolveBaseUrl(context)).toBe("https://staging.example.com");
    expect(resolveAuthCollection(context)).toBe("admins");
  });

  it("falls back to env config before saved remote auth state", () => {
    const context = createContext();
    context.envConfig = {
      base_url: "https://env.example.com"
    };
    context.state.setRemoteAuth({
      baseUrl: "https://prod.example.com",
      token: "secret-token",
      collection: "users"
    });

    expect(resolveBaseUrl(context)).toBe("https://env.example.com");
    expect(resolveAuthCollection(context)).toBe("users");
  });

  it("still falls back to saved remote auth state when no config override exists", () => {
    const context = createContext();
    context.state.setRemoteAuth({
      baseUrl: "https://prod.example.com",
      token: "secret-token",
      collection: "users"
    });

    expect(resolveBaseUrl(context)).toBe("https://prod.example.com");
    expect(resolveAuthCollection(context)).toBe("users");
  });

  it("does not fail startup when env base_url is invalid", async () => {
    const previousBaseUrl = process.env.POCKETBASE_CLI_BASE_URL;
    const previousStateDir = process.env.POCKETBASE_CLI_STATE_DIR;
    process.env.POCKETBASE_CLI_BASE_URL = "not-a-url";
    process.env.POCKETBASE_CLI_STATE_DIR = "/tmp/pocketbase-cli-context-invalid-env";

    try {
      const context = await createAppContext();
      expect(context.version).toBe(CLI_VERSION);
      expect(context.envConfig?.base_url).toBeUndefined();
      expect(context.envConfig?.base_url_error).toContain("expects an absolute http:// or https:// URL");
      expect(resolveBaseUrl(context)).toBeNull();
    } finally {
      if (previousBaseUrl === undefined) {
        delete process.env.POCKETBASE_CLI_BASE_URL;
      } else {
        process.env.POCKETBASE_CLI_BASE_URL = previousBaseUrl;
      }

      if (previousStateDir === undefined) {
        delete process.env.POCKETBASE_CLI_STATE_DIR;
      } else {
        process.env.POCKETBASE_CLI_STATE_DIR = previousStateDir;
      }
    }
  });
});
