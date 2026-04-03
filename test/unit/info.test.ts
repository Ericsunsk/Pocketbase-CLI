import { afterEach, describe, expect, it, vi } from "vitest";

import { createInfoDefinition } from "../../src/commands/info";
import { makeContext } from "./helpers/context";
import { captureStdout } from "./helpers/output";

describe("info command", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("redacts nested secret fields in saved auth output", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({ ok: true })
      })
    );

    const context = makeContext({
      jsonMode: true,
      authed: true,
      token: "secret-token",
      record: {
        id: "superuser_1",
        apiKey: "raw-api-key",
        nested: {
          accessToken: "raw-access-token",
          signedUrl: "https://pb.example.com/api/files/users/rec1/avatar.png?token=file-token"
        }
      }
    });
    const command = createInfoDefinition(context).build?.();
    const stdout = captureStdout();

    try {
      await command?.parseAsync(["node", "info"]);
    } finally {
      stdout.restore();
    }

    const payload = JSON.parse(stdout.output.join("").trim()) as {
      data: {
        remote_auth: {
          record: {
            apiKey: string;
            nested: {
              accessToken: string;
              signedUrl: string;
            };
          };
        };
      };
    };

    expect(payload.data.remote_auth.record.apiKey).toBe("********");
    expect(payload.data.remote_auth.record.nested.accessToken).toBe("********");
    expect(payload.data.remote_auth.record.nested.signedUrl).toContain("token=********");
  });
});
