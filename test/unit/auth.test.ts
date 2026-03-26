import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCli } from "../../src/cli";
import { createAppContext } from "../../src/app/context";
import { CliExitError } from "../../src/core/output";

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

describe("auth commands", () => {
  beforeEach(() => {
    process.env.POCKETBASE_CLI_STATE_DIR = "/tmp/pocketbase-cli-auth-tests";
    vi.restoreAllMocks();
  });

  it("logs in with positional password and persists auth state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () =>
          JSON.stringify({
            token: "secret-token",
            record: { id: "superuser_1", email: "admin@example.com" }
          })
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
  });

  it("redacts password-stdin login history without persisting the flag", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () =>
          JSON.stringify({
            token: "secret-token",
            record: { id: "superuser_1", email: "admin@example.com" }
          })
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
});
