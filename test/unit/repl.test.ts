import { describe, expect, it, vi } from "vitest";

import type { AppContext } from "../../src/app/context";
import { PocketBaseRepl, ReplEofError, sanitizeHistoryTokens } from "../../src/core/repl";
import { CliExitError, SCHEMA_VERSION } from "../../src/core/output";
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
        "auth",
        "login",
        "admin@example.com",
        "Secret123",
        "--password-stdin"
      ])
    ).toBe("auth login admin@example.com ******** --password-stdin");
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
    expect(
      sanitizeHistoryTokens([
        "files",
        "url",
        "users",
        "rec1",
        "avatar.png",
        "--token",
        "secret-token"
      ])
    ).toBe("files url users rec1 avatar.png --token ********");
    expect(
      sanitizeHistoryTokens([
        "backups",
        "download",
        "nightly.zip",
        "--token",
        "secret-token"
      ])
    ).toBe("backups download nightly.zip --token ********");
    expect(
      sanitizeHistoryTokens([
        "raw",
        "GET",
        "/api/files/users/rec1/avatar.png?token=secret-token#fragment",
        "--with-auth"
      ])
    ).toBe("raw GET /api/files/users/rec1/avatar.png?<redacted>#<redacted> --with-auth");
    expect(
      sanitizeHistoryTokens([
        "records",
        "auth-password",
        "users",
        "admin@example.com",
        "Secret123",
        "--fields",
        "id,email"
      ])
    ).toBe("records auth-password users admin@example.com ******** --fields id,email");
    expect(
      sanitizeHistoryTokens([
        "records",
        "auth-otp",
        "users",
        "otp-id",
        "654321",
        "--mfa-id",
        "mfa_123"
      ])
    ).toBe("records auth-otp users otp-id ******** --mfa-id mfa_123");
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
      action: "repl.start",
      schema_version: SCHEMA_VERSION
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
    expect(historyPayload?.result).toMatchObject({
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

  it("persists history even when dispatch exits with CliExitError", async () => {
    const context = createContext();
    const saveState = vi.fn(async () => undefined);
    const repl = new PocketBaseRepl({
      context,
      dispatch: async () => {
        throw new CliExitError(1, "boom");
      },
      jsonOutput: true,
      stdout: createWriter([]),
      stderr: createWriter([]),
      saveState,
      readLine: async () => {
        if (context.state.commandHistory.length > 0) {
          throw new ReplEofError();
        }

        return "raw GET /api/files/users/rec1/avatar.png?token=secret-token#fragment --with-auth";
      }
    });

    await repl.run();

    expect(saveState).toHaveBeenCalledOnce();
    expect(context.state.commandHistory).toEqual([
      "raw GET /api/files/users/rec1/avatar.png?<redacted>#<redacted> --with-auth"
    ]);
  });

  it("clears saved auth when built-in config set changes the target", async () => {
    const context = createContext();
    context.state.setRemoteAuth({
      baseUrl: "https://prod.example.com",
      token: "secret-token",
      collection: "_superusers"
    });
    const stdout: string[] = [];
    const lines = ["config set base_url https://staging.example.com", "quit"];

    const repl = new PocketBaseRepl({
      context,
      dispatch: async () => undefined,
      jsonOutput: true,
      stdout: createWriter(stdout),
      stderr: createWriter([]),
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
    const configSetPayload = payloads.find((payload) => payload.action === "config.set");

    expect(configSetPayload).toMatchObject({
      message: "Config updated and saved auth cleared",
      data: {
        auth_cleared: true
      }
    });
    expect(context.state.hasRemoteAuth()).toBe(false);
  });

  it("does not emit a duplicate repl.dispatch error when a command already exited cleanly", async () => {
    const context = createContext();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const lines = ["info", "quit"];

    const repl = new PocketBaseRepl({
      context,
      dispatch: async () => {
        throw new CliExitError(1, "command failed");
      },
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

    expect(payloads.some((payload) => payload.action === "repl.dispatch")).toBe(false);
    expect(stderr).toEqual([]);
  });

  it("rejects unterminated quoted input instead of dispatching it", async () => {
    const context = createContext();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const dispatch = vi.fn(async () => undefined);
    const lines = ["config set base_url 'https://pb.example.com", "quit"];

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

    const payloads = stderr
      .join("")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(payloads.some((payload) => payload.action === "repl.parse")).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
    expect(context.state.commandHistory).toEqual(["quit"]);
  });
});
