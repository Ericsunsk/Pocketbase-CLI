import { describe, expect, it } from "vitest";

import { createCli } from "../../src/cli";
import { SessionState, SessionStore } from "../../src/core/session-store";

function context() {
  return {
    version: "0.1.0",
    jsonMode: true,
    store: new SessionStore("/tmp/pocketbase-cli-history-tests.json"),
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
});
