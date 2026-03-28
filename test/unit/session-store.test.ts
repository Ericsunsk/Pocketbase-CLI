import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
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

  it("fails fast on corrupt json", async () => {
    const root = await mkdtemp(join(tmpdir(), "pb-cli-session-"));
    const path = join(root, "session.json");
    await writeFile(path, "{not-json", "utf8");

    await expect(new SessionStore(path).load()).rejects.toThrow(
      `Failed to parse session state at ${path}.`
    );
  });

  it("parses config values with python-compatible semantics", () => {
    expect(parseConfigValue("base_url", "https://pb.example.com/")).toBe(
      "https://pb.example.com"
    );
    expect(parseConfigValue("base_url", "http://127.0.0.1:8090/pocketbase/")).toBe(
      "http://127.0.0.1:8090/pocketbase"
    );
    expect(parseConfigValue("timeout", "30")).toBe(30);
    expect(parseConfigValue("base_url", "unset")).toBeNull();
    expect(() => parseConfigValue("base_url", "ftp://pb.example.com")).toThrow(
      "base_url expects an absolute http:// or https:// URL"
    );
    expect(() => parseConfigValue("base_url", "https://pb.example.com?token=x")).toThrow(
      "base_url must not include query parameters or fragments"
    );
  });

  it("loads legacy plaintext session files", async () => {
    const root = await mkdtemp(join(tmpdir(), "pb-cli-session-"));
    const path = join(root, "session.json");
    await writeFile(
      path,
      JSON.stringify({
        config: {
          base_url: "https://pb.example.com"
        },
        remote_auth: {
          base_url: "https://pb.example.com",
          token: "legacy-token"
        },
        command_history: ["info"],
        undo_stack: [],
        redo_stack: []
      }),
      "utf8"
    );

    const loaded = await new SessionStore(path).load();

    expect(loaded.config.base_url).toBe("https://pb.example.com");
    expect(loaded.remoteAuth.token).toBe("legacy-token");
    expect(loaded.commandHistory).toEqual(["info"]);
  });

  it("writes encrypted session envelopes without leaking token plaintext", async () => {
    const root = await mkdtemp(join(tmpdir(), "pb-cli-session-"));
    const path = join(root, "session.json");
    const store = new SessionStore(path);
    const state = new SessionState();

    state.setRemoteAuth({
      baseUrl: "https://pb.example.com",
      token: "secret-token",
      record: { id: "superuser_1" }
    });

    await store.save(state);

    const payload = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    const raw = await readFile(path, "utf8");

    expect(payload.format).toBe("pocketbase-cli.session.encrypted/v1");
    expect(Object.keys(payload)).toEqual([
      "format",
      "algorithm",
      "iv",
      "tag",
      "ciphertext"
    ]);
    expect(raw).not.toContain("secret-token");
  });

  it("writes session state with private file permissions", async () => {
    const root = await mkdtemp(join(tmpdir(), "pb-cli-session-"));
    const path = join(root, "session.json");
    const store = new SessionStore(path);

    await store.save(new SessionState());

    const fileStats = await stat(path);
    expect(fileStats.mode & 0o777).toBe(0o600);

    const keyStats = await stat(store.keyPath);
    expect(keyStats.mode & 0o777).toBe(0o600);
  });
});
