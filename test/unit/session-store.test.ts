import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { SessionState, SessionStore } from "../../src/core/session-store";
import { parseConfigValue } from "../../src/input/validators";

describe("SessionStore", () => {
  afterEach(() => {
    delete process.env.POCKETBASE_CLI_STATE_DIR;
  });

  it("round-trips config and auth state", async () => {
    const root = await mkdtemp(join(tmpdir(), "pb-cli-session-"));
    const store = new SessionStore(join(root, "session.json"));
    const state = new SessionState();

    state.setConfig("base_url", "https://pb.example.com");
    state.setConfig("timeout", 15);
    state.setRemoteAuth({
      baseUrl: "https://pb.example.com/",
      token: "secret-token",
      record: { id: "superuser_1" }
    });

    await store.save(state);
    const loaded = await store.load();

    expect(loaded.config.base_url).toBe("https://pb.example.com");
    expect(loaded.config.timeout).toBe(15);
    expect(loaded.remoteAuth.base_url).toBe("https://pb.example.com");
    expect(loaded.remoteAuth.record).toEqual({ id: "superuser_1" });
  });

  it("falls back safely on corrupt json", async () => {
    const root = await mkdtemp(join(tmpdir(), "pb-cli-session-"));
    const path = join(root, "session.json");
    await writeFile(path, "{not-json", "utf8");

    const loaded = await new SessionStore(path).load();
    expect(loaded.commandHistory).toEqual([]);
    expect(loaded.hasRemoteAuth()).toBe(false);
  });

  it("parses config values with python-compatible semantics", () => {
    expect(parseConfigValue("base_url", "https://pb.example.com/")).toBe(
      "https://pb.example.com"
    );
    expect(parseConfigValue("timeout", "30")).toBe(30);
    expect(parseConfigValue("base_url", "unset")).toBeNull();
  });

  it("writes a python-compatible top-level shape", async () => {
    const root = await mkdtemp(join(tmpdir(), "pb-cli-session-"));
    const path = join(root, "session.json");
    const store = new SessionStore(path);
    const state = new SessionState();

    state.recordCommand("info");
    await store.save(state);

    const payload = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual([
      "config",
      "remote_auth",
      "command_history",
      "undo_stack",
      "redo_stack"
    ]);
  });
});
