import { describe, expect, it } from "vitest";

import { createCli } from "../../src/cli";
import { SessionState, SessionStore } from "../../src/core/session-store";
import { captureStdout } from "./helpers/output";

describe("createCli", () => {
  it("registers migrated commands on the root program", () => {
    const cli = createCli({
      version: "0.1.0",
      jsonMode: false,
      store: new SessionStore("/tmp/pocketbase-cli-cli-test-session.json"),
      state: new SessionState()
    });

    const names = cli.commands.map((command) => command.name());
    expect(names).toEqual(
      expect.arrayContaining([
        "repl",
        "info",
        "preflight",
        "schema",
        "config",
        "auth",
        "raw",
        "collections",
        "files",
        "backups",
        "records",
        "batch"
      ])
    );
  });

  it("runs external repl commands in json mode without downgrading output format", async () => {
    const cli = createCli({
      version: "0.1.0",
      jsonMode: true,
      suppressHistory: false,
      onStateSaved: undefined,
      store: new SessionStore("/tmp/pocketbase-cli-cli-test-session.json"),
      state: new SessionState()
    });

    const stdout = captureStdout();
    const stdin = process.stdin as NodeJS.ReadStream & {
      [Symbol.asyncIterator]?: () => AsyncIterator<string>;
    };
    const originalIterator = stdin[Symbol.asyncIterator];

    stdin[Symbol.asyncIterator] = async function* (): AsyncGenerator<string> {
      yield "info\nexit\n";
    };

    try {
      await cli.parseAsync(["node", "pocketbase-cli", "--json"]);
    } finally {
      stdout.restore();
      if (originalIterator) {
        stdin[Symbol.asyncIterator] = originalIterator;
      } else {
        Reflect.deleteProperty(
          stdin as NodeJS.ReadStream & Record<PropertyKey, unknown>,
          Symbol.asyncIterator
        );
      }
    }

    const payloads = stdout.output
      .join("")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(payloads.some((payload) => payload.action === "info")).toBe(true);
    expect(payloads.at(-1)).toMatchObject({
      ok: true,
      action: "repl.exit"
    });
  });
});
