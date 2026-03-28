import { describe, expect, it } from "vitest";

import { createCli } from "../../src/cli";
import { makeContext } from "./helpers/context";
import { captureStdout } from "./helpers/output";

function createContext(options?: {
  baseUrl?: string;
  envBaseUrl?: string;
  authBaseUrl?: string;
  authCollection?: string;
}) {
  return makeContext({
    storePath: "/tmp/pocketbase-cli-preflight-test-session.json",
    jsonMode: true,
    baseUrl: options?.baseUrl,
    envBaseUrl: options?.envBaseUrl,
    authed: Boolean(options?.authBaseUrl),
    authBaseUrl: options?.authBaseUrl,
    authCollection: options?.authBaseUrl ? (options.authCollection ?? "_superusers") : undefined
  });
}

describe("preflight command", () => {
  it("reports missing prerequisites without mutating state", async () => {
    const context = createContext();
    const cli = createCli(context);
    const stdout = captureStdout();

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
      stdout.restore();
    }

    const payload = JSON.parse(stdout.output.join("").trim()) as {
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
    const stdout = captureStdout();

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
      stdout.restore();
    }

    const payload = JSON.parse(stdout.output.join("").trim()) as {
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

  it("accepts the base URL from env config when no saved config exists", async () => {
    const context = createContext({
      envBaseUrl: "https://pb.example.com",
      authBaseUrl: "https://pb.example.com"
    });
    const cli = createCli(context);
    const stdout = captureStdout();

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
      stdout.restore();
    }

    const payload = JSON.parse(stdout.output.join("").trim()) as {
      message: string;
      result: {
        ready: boolean;
        resolved_base_url: string | null;
      };
    };

    expect(payload.message).toBe("Preflight check passed");
    expect(payload.result.ready).toBe(true);
    expect(payload.result.resolved_base_url).toBe("https://pb.example.com");
  });
});
