import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCli } from "../../src/cli";
import { createAppContext } from "../../src/app/context";
import { CliExitError } from "../../src/core/output";
import {
  PocketBaseRemoteClient,
  PocketBaseRemoteError,
  type RemoteResult
} from "../../src/http/remote-client";
import { captureStderr, captureStdout } from "./helpers/output";

const REAL_FETCH = globalThis.fetch;

describe("auth commands", () => {
  beforeEach(() => {
    process.env.POCKETBASE_CLI_STATE_DIR = "/tmp/pocketbase-cli-auth-tests";
    delete process.env.POCKETBASE_CLI_BASE_URL;
    if (REAL_FETCH) {
      globalThis.fetch = REAL_FETCH;
    }
    vi.restoreAllMocks();
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

  it("requires --yes for logout in json mode", async () => {
    const context = await createAppContext();
    context.state.setRemoteAuth({
      baseUrl: "https://pb.example.com",
      token: "secret-token",
      record: { id: "superuser_1" }
    });

    const cli = createCli(context);
    const stdout = captureStdout();
    const stderr = captureStderr();

    try {
      await expect(
        cli.parseAsync(["node", "pocketbase-cli", "--json", "auth", "logout"])
      ).rejects.toBeInstanceOf(CliExitError);
    } finally {
      stdout.restore();
      stderr.restore();
    }

    expect(context.state.hasRemoteAuth()).toBe(true);
  });

  it("redacts nested secret fields in auth status output", async () => {
    const context = await createAppContext();
    context.state.setRemoteAuth({
      baseUrl: "https://pb.example.com",
      token: "secret-token",
      record: {
        id: "superuser_1",
        apiKey: "raw-api-key",
        nested: {
          clientSecret: "raw-client-secret",
          signedUrl: "https://pb.example.com/api/files/users/rec1/avatar.png?token=file-token"
        }
      }
    });

    const cli = createCli(context);
    const stdout = captureStdout();

    try {
      await cli.parseAsync(["node", "pocketbase-cli", "--json", "auth", "status"]);
    } finally {
      stdout.restore();
    }

    const payload = JSON.parse(stdout.output.join("").trim()) as {
      data: {
        record: {
          apiKey: string;
          nested: {
            clientSecret: string;
            signedUrl: string;
          };
        };
      };
    };

    expect(payload.data.record.apiKey).toBe("********");
    expect(payload.data.record.nested.clientSecret).toBe("********");
    expect(payload.data.record.nested.signedUrl).toContain("token=********");
  });

  it("serves a browser login page and persists auth state after form submit", async () => {
    process.env.POCKETBASE_CLI_BASE_URL = "https://pb.example.com";

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
        "login",
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
          baseUrl: "https://pb.example.com",
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
    expect(context.state.commandHistory.at(-1)).toBe("auth login --no-open --timeout 5");

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
    expect(payload.action).toBe("auth.login");
    expect(payload.message).toBe("Remote auth login successful and preflight passed");
    expect(payload.data.auth.data.token).toBe("********");
    expect(payload.data.preflight.ready).toBe(true);
  });

  it("starts the browser login page without waiting for auth-methods probing", async () => {
    process.env.POCKETBASE_CLI_BASE_URL = "https://pb.example.com";

    vi.spyOn(PocketBaseRemoteClient.prototype, "recordAuthMethods").mockImplementation(
      () => new Promise<RemoteResult<Record<string, unknown>>>(() => undefined)
    );
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
        "login",
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
      expect(html).toContain('label for="identity">Identity<');

      const stateMatch = html.match(/name="state" value="([^"]+)"/u);
      expect(stateMatch?.[1]).toBeTruthy();

      const response = await fetch(String(launchUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          state: String(stateMatch?.[1]),
          baseUrl: "https://pb.example.com",
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
  });

  it("reports browser login success without claiming preflight passed when health fails", async () => {
    process.env.POCKETBASE_CLI_BASE_URL = "https://pb.example.com";

    vi.spyOn(PocketBaseRemoteClient.prototype, "login").mockResolvedValue({
      method: "POST",
      url: "https://pb.example.com/api/collections/_superusers/auth-with-password",
      status: 200,
      data: {
        token: "secret-token",
        record: { id: "superuser_1", email: "admin@example.com" }
      }
    });
    vi.spyOn(PocketBaseRemoteClient.prototype, "raw").mockRejectedValue(
      new PocketBaseRemoteError({
        method: "GET",
        url: "https://pb.example.com/api/health",
        status: 503,
        message: "health probe failed",
        data: {}
      })
    );

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
        "login",
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
          baseUrl: "https://pb.example.com",
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

    const payload = JSON.parse(stdout.output.join("").trim()) as {
      message: string;
      data: {
        preflight: {
          ready: boolean;
          health: {
            status: string;
          };
        };
      };
    };

    expect(payload.message).toBe("Remote auth login successful but preflight reported issues");
    expect(payload.data.preflight.ready).toBe(false);
    expect(payload.data.preflight.health.status).toBe("fail");
  });

  it("redacts nested secret fields in auth refresh output", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () =>
          JSON.stringify({
            token: "next-token",
            record: {
              id: "superuser_1",
              apiKey: "raw-api-key",
              nested: {
                clientSecret: "raw-client-secret",
                signedUrl:
                  "https://pb.example.com/api/files/users/rec1/avatar.png?token=file-token"
              }
            }
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
    const stdout = captureStdout();

    try {
      await cli.parseAsync(["node", "pocketbase-cli", "--json", "auth", "refresh"]);
    } finally {
      stdout.restore();
    }

    const payload = JSON.parse(stdout.output.join("").trim()) as {
      data: {
        auth: {
          data: {
            token: string;
            record: {
              apiKey: string;
              nested: {
                clientSecret: string;
                signedUrl: string;
              };
            };
          };
        };
      };
    };

    expect(payload.data.auth.data.token).toBe("********");
    expect(payload.data.auth.data.record.apiKey).toBe("********");
    expect(payload.data.auth.data.record.nested.clientSecret).toBe("********");
    expect(payload.data.auth.data.record.nested.signedUrl).toContain("token=********");
    expect((context.state.remoteAuth.record as { apiKey: string }).apiKey).toBe("raw-api-key");
  });
});
