import { describe, expect, it } from "vitest";

import { createCli } from "../../src/cli";
import { CliExitError } from "../../src/core/output";
import { makeContext } from "./helpers/context";
import { captureStdout } from "./helpers/output";

function createContext() {
  return makeContext({
    storePath: "/tmp/pocketbase-cli-config-test-session.json",
    jsonMode: true,
    authBaseUrl: "https://prod.example.com",
    authCollection: "_superusers",
    token: "secret-token"
  });
}

describe("config commands", () => {
  it("clears saved auth when base_url is changed to a different target", async () => {
    const context = createContext();
    const cli = createCli(context);
    const stdout = captureStdout();

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
      stdout.restore();
    }

    const payload = JSON.parse(stdout.output.join("").trim()) as {
      message: string;
      data: { auth_cleared: boolean };
    };

    expect(context.state.hasRemoteAuth()).toBe(false);
    expect(payload.message).toBe("Config updated and saved auth cleared");
    expect(payload.data.auth_cleared).toBe(true);
  });

  it("rejects non-positive timeout config values", async () => {
    const context = createContext();
    const cli = createCli(context);
    const stdout = captureStdout();

    try {
      await expect(
        cli.parseAsync([
          "node",
          "pocketbase-cli",
          "--json",
          "config",
          "set",
          "timeout",
          "0"
        ])
      ).rejects.toBeInstanceOf(CliExitError);
    } finally {
      stdout.restore();
    }

    expect(context.state.config.timeout).toBeUndefined();
  });
});
