import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCli } from "../../src/cli";
import { createAppContext } from "../../src/app/context";
import { CliExitError } from "../../src/core/output";
import { PocketBaseRemoteClient } from "../../src/http/remote-client";

const REAL_FETCH = globalThis.fetch;

function captureStdout(): {
  output: string[];
  restore: () => void;
} {
  const output: string[] = [];
  const original = process.stdout.write.bind(process.stdout);

  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    output.push(String(chunk));
    return true;
  });

  return {
    output,
    restore: () => {
      (process.stdout.write as unknown as ReturnType<typeof vi.spyOn>).mockRestore?.();
      process.stdout.write = original as typeof process.stdout.write;
    }
  };
}

function captureStderr(): {
  output: string[];
  restore: () => void;
} {
  const output: string[] = [];
  const original = process.stderr.write.bind(process.stderr);

  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    output.push(String(chunk));
    return true;
  });

  return {
    output,
    restore: () => {
      (process.stderr.write as unknown as ReturnType<typeof vi.spyOn>).mockRestore?.();
      process.stderr.write = original as typeof process.stderr.write;
    }
  };
}

describe("auth commands", () => {
  beforeEach(() => {
    process.env.POCKETBASE_CLI_STATE_DIR = "/tmp/pocketbase-cli-auth-tests";
    delete process.env.POCKETBASE_CLI_BASE_URL;
    delete process.env.POCKETBASE_CLI_AUTH_IDENTITY;
    delete process.env.POCKETBASE_CLI_AUTH_PASSWORD;
    if (REAL_FETCH) {
      globalThis.fetch = REAL_FETCH;
    }
    vi.restoreAllMocks();
  });

  it("logs in with positional password and persists auth state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/api/health")) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () =>
              JSON.stringify({
                message: "API is healthy.",
                code: 200,
                data: {}
              })
          };
        }

        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () =>
            JSON.stringify({
              token: "secret-token",
              record: { id: "superuser_1", email: "admin@example.com" }
            })
        };
      })
    );

    const context = await createAppContext();
    const cli = createCli(context);
    const capture = captureStdout();

    try {
      await cli.parseAsync([
        "node",
        "pocketbase-cli",
        "--json",
        "config",
        "set",
        "base_url",
        "https://pb.example.com"
      ]);
      await cli.parseAsync([
        "node",
        "pocketbase-cli",
        "--json",
        "auth",
        "login",
        "admin@example.com",
        "Secret123"
      ]);
    } finally {
      capture.restore();
    }

    expect(context.state.hasRemoteAuth()).toBe(true);
    expect(context.state.remoteAuth.base_url).toBe("https://pb.example.com");
    expect(context.state.remoteAuth.record).toEqual({
      id: "superuser_1",
      email: "admin@example.com"
    });
    expect(capture.output.join("")).not.toContain("secret-token");
    expect(capture.output.join("")).toContain("********");
  });

  it("redacts password-stdin login history without persisting the flag", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/api/health")) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () =>
              JSON.stringify({
                message: "API is healthy.",
                code: 200,
                data: {}
              })
          };
        }

        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () =>
            JSON.stringify({
              token: "secret-token",
              record: { id: "superuser_1", email: "admin@example.com" }
            })
        };
      })
    );

    const stdin = process.stdin as NodeJS.ReadStream & {
      [Symbol.asyncIterator]?: () => AsyncIterator<string>;
    };
    const originalIterator = stdin[Symbol.asyncIterator];
    stdin[Symbol.asyncIterator] = async function* (): AsyncGenerator<string> {
      yield "Secret123\n";
    };

    const context = await createAppContext();
    const cli = createCli(context);
    const capture = captureStdout();

    try {
      await cli.parseAsync([
        "node",
        "pocketbase-cli",
        "--json",
        "config",
        "set",
        "base_url",
        "https://pb.example.com"
      ]);
      await cli.parseAsync([
        "node",
        "pocketbase-cli",
        "--json",
        "auth",
        "login",
        "--password-stdin",
        "admin@example.com"
      ]);
    } finally {
      capture.restore();
      if (originalIterator) {
        stdin[Symbol.asyncIterator] = originalIterator;
      } else {
        Reflect.deleteProperty(
          stdin as NodeJS.ReadStream & Record<PropertyKey, unknown>,
          Symbol.asyncIterator
        );
      }
    }

    expect(context.state.commandHistory.at(-1)).toBe("auth login admin@example.com ********");
  });

  it("refreshes saved auth and updates state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () =>
          JSON.stringify({
            token: "next-token",
            record: { id: "superuser_1" }
          })
      })
    );

    const context = await createAppContext();
    context.state.setRemoteAuth({
      baseUrl: "https://pb.example.com",
      token: "old-token",
      record: { id: "superuser_1" }
    });

    const cli = createCli(context);
    const capture = captureStdout();

    try {
      await cli.parseAsync(["node", "pocketbase-cli", "--json", "auth", "refresh"]);
    } finally {
      capture.restore();
    }

    expect(context.state.remoteAuth.token).toBe("next-token");
  });

  it("logout with --yes clears auth state", async () => {
    const context = await createAppContext();
    context.state.setRemoteAuth({
      baseUrl: "https://pb.example.com",
      token: "secret-token",
      record: { id: "superuser_1" }
    });

    const cli = createCli(context);
    const capture = captureStdout();

    try {
      await cli.parseAsync(["node", "pocketbase-cli", "--json", "auth", "logout", "--yes"]);
    } finally {
      capture.restore();
    }

    expect(context.state.hasRemoteAuth()).toBe(false);
  });

  it("auth login rejects missing identity", async () => {
    const context = await createAppContext();
    const cli = createCli(context);
    const capture = captureStdout();

    await expect(
      cli.parseAsync(["node", "pocketbase-cli", "--json", "auth", "login"])
    ).rejects.toBeInstanceOf(CliExitError);

    capture.restore();
  });

  it("logs in with env-provided target and credentials", async () => {
    process.env.POCKETBASE_CLI_BASE_URL = "https://pb.example.com";
    process.env.POCKETBASE_CLI_AUTH_IDENTITY = "admin@example.com";
    process.env.POCKETBASE_CLI_AUTH_PASSWORD = "Secret123";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/api/health")) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () =>
              JSON.stringify({
                message: "API is healthy.",
                code: 200,
                data: {}
              })
          };
        }

        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () =>
            JSON.stringify({
              token: "secret-token",
              record: { id: "superuser_1", email: "admin@example.com" }
            })
        };
      })
    );

    const context = await createAppContext();
    const cli = createCli(context);
    const capture = captureStdout();

    try {
      await cli.parseAsync(["node", "pocketbase-cli", "--json", "auth", "login"]);
    } finally {
      capture.restore();
    }

    expect(context.state.hasRemoteAuth()).toBe(true);
    expect(context.state.remoteAuth.base_url).toBe("https://pb.example.com");
    expect(context.state.remoteAuth.collection).toBe("_superusers");
    expect(context.state.commandHistory.at(-1)).toBe("auth login admin@example.com ********");
  });

  it("serves a browser login page and persists auth state after form submit", async () => {
    process.env.POCKETBASE_CLI_BASE_URL = "https://pb.example.com";
    process.env.POCKETBASE_CLI_AUTH_IDENTITY = "admin@example.com";

    vi.spyOn(PocketBaseRemoteClient.prototype, "login").mockResolvedValue({
      method: "POST",
      url: "https://pb.example.com/api/collections/_superusers/auth-with-password",
      status: 200,
      data: {
        token: "secret-token",
        record: { id: "superuser_1", email: "admin@example.com" }
      }
    });
    vi.spyOn(PocketBaseRemoteClient.prototype, "raw").mockResolvedValue({
      method: "GET",
      url: "https://pb.example.com/api/health",
      status: 200,
      data: {
        message: "API is healthy.",
        code: 200,
        data: {}
      }
    });

    const context = await createAppContext();
    const cli = createCli(context);
    const stdout = captureStdout();
    const stderr = captureStderr();

    try {
      const commandPromise = cli.parseAsync([
        "node",
        "pocketbase-cli",
        "--json",
        "auth",
        "login-browser",
        "--no-open",
        "--timeout",
        "5"
      ]);

      let launchUrl: string | null = null;
      for (let attempt = 0; attempt < 50 && !launchUrl; attempt += 1) {
        const combined = stderr.output.join("");
        const match = combined.match(/http:\/\/127\.0\.0\.1:\d+\/login\/[a-f0-9]+/u);
        launchUrl = match?.[0] ?? null;
        if (!launchUrl) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }

      expect(launchUrl).toBeTruthy();

      const formPage = await fetch(String(launchUrl));
      const html = await formPage.text();
      const stateMatch = html.match(/name="state" value="([^"]+)"/u);
      expect(stateMatch?.[1]).toBeTruthy();

      const response = await fetch(String(launchUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          state: String(stateMatch?.[1]),
          identity: "admin@example.com",
          password: "Secret123"
        })
      });

      expect(response.status).toBe(200);
      await commandPromise;
    } finally {
      stdout.restore();
      stderr.restore();
    }

    expect(context.state.hasRemoteAuth()).toBe(true);
    expect(context.state.remoteAuth.base_url).toBe("https://pb.example.com");
    expect(context.state.commandHistory.at(-1)).toBe("auth login-browser --no-open --timeout 5");

    const payload = JSON.parse(stdout.output.join("").trim()) as {
      action: string;
      message: string;
      data: {
        auth: {
          data: {
            token: string;
          };
        };
        preflight: {
          ready: boolean;
        };
      };
    };
    expect(payload.action).toBe("auth.login-browser");
    expect(payload.message).toBe("Remote auth login successful and preflight passed");
    expect(payload.data.auth.data.token).toBe("********");
    expect(payload.data.preflight.ready).toBe(true);
  });
});
