import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createCli } from "../../src/cli";
import { CliExitError } from "../../src/core/output";
import { SessionState, SessionStore } from "../../src/core/session-store";

let historyContextCounter = 0;

function context() {
  const suffix = `${process.pid}-${Date.now()}-${historyContextCounter++}`;

  return {
    version: "0.1.0",
    jsonMode: true,
    store: new SessionStore(join(tmpdir(), `pocketbase-cli-history-tests-${suffix}.json`)),
    state: new SessionState()
  };
}

describe("history/undo/redo commands", () => {
  it("history returns recent items without mutating history", async () => {
    const app = context();
    app.state.recordCommand("info");
    app.state.recordCommand("auth status");
    const cli = createCli(app);

    const writes: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      await cli.parseAsync(["node", "pocketbase-cli", "--json", "history", "--limit", "1"]);
    } finally {
      process.stdout.write = original;
    }

    const payload = JSON.parse(writes.join("").trim()) as { data: { items: string[] } };
    expect(payload.data.items).toEqual(["auth status"]);
    expect(app.state.commandHistory).toEqual(["info", "auth status"]);
  });

  it("undo and redo mutate config as expected", async () => {
    const app = context();
    app.state.setConfig("base_url", "https://pb.example.com");
    const cli = createCli(app);

    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (() => true) as typeof process.stdout.write;

    try {
      await cli.parseAsync(["node", "pocketbase-cli", "--json", "undo"]);
      expect(app.state.config.base_url).toBeUndefined();

      await cli.parseAsync(["node", "pocketbase-cli", "--json", "redo"]);
      expect(app.state.config.base_url).toBe("https://pb.example.com");
    } finally {
      process.stdout.write = original;
    }
  });

  it("redo clears saved auth when the restored config target no longer matches", async () => {
    const app = context();
    app.state.setRemoteAuth({
      baseUrl: "https://prod.example.com",
      token: "secret-token",
      collection: "_superusers"
    });
    app.state.setConfig("auth_collection", "admins");
    app.state.undo();

    const cli = createCli(app);
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (() => true) as typeof process.stdout.write;

    try {
      await cli.parseAsync(["node", "pocketbase-cli", "--json", "redo"]);
      expect(app.state.hasRemoteAuth()).toBe(false);
      expect(app.state.config.auth_collection).toBe("admins");
    } finally {
      process.stdout.write = original;
    }
  });

  it("rejects non-integer history limits", async () => {
    const app = context();
    const cli = createCli(app);

    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (() => true) as typeof process.stdout.write;

    try {
      await expect(
        cli.parseAsync(["node", "pocketbase-cli", "--json", "history", "--limit", "abc"])
      ).rejects.toBeInstanceOf(CliExitError);
    } finally {
      process.stdout.write = original;
    }
  });

  it("rejects negative history limits", async () => {
    const app = context();
    const cli = createCli(app);

    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (() => true) as typeof process.stdout.write;

    try {
      await expect(
        cli.parseAsync(["node", "pocketbase-cli", "--json", "history", "--limit", "-1"])
      ).rejects.toBeInstanceOf(CliExitError);
    } finally {
      process.stdout.write = original;
    }
  });
});
