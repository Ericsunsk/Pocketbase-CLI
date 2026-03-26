import { describe, expect, it, vi } from "vitest";

import type { AppContext } from "../../src/app/context";
import { PocketBaseRepl, ReplEofError, sanitizeHistoryTokens } from "../../src/core/repl";
import { SessionState, SessionStore } from "../../src/core/session-store";

function createContext(): AppContext {
  return {
    version: "0.1.0",
    jsonMode: true,
    suppressHistory: false,
    onStateSaved: undefined,
    store: new SessionStore("/tmp/pocketbase-cli-repl-test-session.json"),
    state: new SessionState()
  };
}

function createWriter(buffer: string[]): { write: (chunk: string) => boolean } {
  return {
    write: (chunk: string) => {
      buffer.push(chunk);
      return true;
    }
  };
}

describe("sanitizeHistoryTokens", () => {
  it("redacts sensitive auth command values", () => {
    expect(sanitizeHistoryTokens(["auth", "login", "admin@example.com", "Secret123"])).toBe(
      "auth login admin@example.com ********"
    );
    expect(
      sanitizeHistoryTokens([
        "records",
        "confirm-password-reset",
        "users",
        "token123",
        "NewPass123!",
        "NewPass123!"
      ])
    ).toBe("records confirm-password-reset users ******** ******** ********");
    expect(
      sanitizeHistoryTokens([
        "records",
        "auth-oauth2",
        "users",
        "--provider",
        "google",
        "--code",
        "oauth-code",
        "--redirect-url",
        "https://app.example.com/callback",
        "--code-verifier",
        "verifier123"
      ])
    ).toBe(
      "records auth-oauth2 users --provider google --code ******** --redirect-url https://app.example.com/callback --code-verifier ********"
    );
  });
});

describe("PocketBaseRepl", () => {
  it("handles built-in commands and redacts recorded history in json mode", async () => {
    const context = createContext();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const dispatch = vi.fn(async () => undefined);
    const lines = [
      "config set base_url https://pb.example.com",
      "auth login admin@example.com Secret123",
      "history",
      "quit"
    ];

    const repl = new PocketBaseRepl({
      context,
      dispatch,
      jsonOutput: true,
      stdout: createWriter(stdout),
      stderr: createWriter(stderr),
      saveState: async () => undefined,
      readLine: async () => {
        const line = lines.shift();
        if (line === undefined) {
          throw new ReplEofError();
        }
        return line;
      }
    });

    await repl.run();

    const payloads = stdout
      .join("")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(payloads[0]).toMatchObject({
      ok: true,
      action: "repl.start"
    });
    expect(payloads.some((payload) => payload.action === "config.set")).toBe(true);
    expect(payloads.some((payload) => payload.action === "history")).toBe(true);
    expect(payloads[payloads.length - 1]).toMatchObject({
      ok: true,
      action: "repl.exit",
      message: "Bye."
    });

    const historyPayload = payloads.find((payload) => payload.action === "history");
    expect(historyPayload).toBeDefined();
    expect(historyPayload?.data).toMatchObject({
      items: [
        "config set base_url https://pb.example.com",
        "auth login admin@example.com ********",
        "history"
      ]
    });

    expect(dispatch).toHaveBeenCalledWith(["auth", "login", "admin@example.com", "Secret123"]);
    expect(context.state.config.base_url).toBe("https://pb.example.com");
    expect(stderr).toEqual([]);
  });

  it("coalesces repl persistence so built-ins and dispatch each flush once", async () => {
    const context = createContext();
    const stdout: string[] = [];
    const saveState = vi.fn(async () => undefined);
    const dispatch = vi.fn(async () => {
      context.onStateSaved?.();
    });
    const lines = [
      "help",
      "config set base_url https://pb.example.com",
      "info",
      "quit"
    ];

    const repl = new PocketBaseRepl({
      context,
      dispatch,
      jsonOutput: true,
      stdout: createWriter(stdout),
      stderr: createWriter([]),
      saveState,
      readLine: async () => {
        const line = lines.shift();
        if (line === undefined) {
          throw new ReplEofError();
        }
        return line;
      }
    });

    await repl.run();

    expect(saveState).toHaveBeenCalledTimes(3);
    expect(dispatch).toHaveBeenCalledWith(["info"]);
  });
});
