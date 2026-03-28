import { afterEach, describe, expect, it, vi } from "vitest";

import { createFilesDefinition } from "../../src/commands/files";
import { CliExitError } from "../../src/core/output";
import { PocketBaseRemoteClient } from "../../src/http/remote-client";
import { buildSubcommand } from "./helpers/command";
import { makeContext } from "./helpers/context";
import { captureStdout } from "./helpers/output";

function buildContext(options?: { jsonMode?: boolean }) {
  return makeContext({
    storePath: "/tmp/pocketbase-cli-files-session.json",
    baseUrl: "https://pb.example.com",
    authed: true,
    jsonMode: options?.jsonMode ?? false
  });
}

describe("files commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redacts explicit file token from history", async () => {
    const context = buildContext();
    const spy = vi.spyOn(PocketBaseRemoteClient.prototype, "filesToken");

    const command = buildSubcommand(createFilesDefinition(context), "url");

    await command?.parseAsync([
      "node",
      "url",
      "users",
      "rec1",
      "avatar.png",
      "--token",
      "secret-token"
    ]);

    expect(context.state.commandHistory.at(-1)).toBe(
      "files url users rec1 avatar.png --token ********"
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("fetches a temporary token when --with-token is set", async () => {
    const context = buildContext();
    const spy = vi.spyOn(PocketBaseRemoteClient.prototype, "filesToken").mockResolvedValue({
      method: "POST",
      url: "/api/files/token",
      status: 200,
      data: {
        token: "generated-token"
      }
    });

    const command = buildSubcommand(createFilesDefinition(context), "url");

    await command?.parseAsync(["node", "url", "users", "rec1", "avatar.png", "--with-token"]);

    expect(spy).toHaveBeenCalledOnce();
    expect(context.state.commandHistory.at(-1)).toBe(
      "files url users rec1 avatar.png --with-token"
    );
  });

  it("redacts generated file tokens from files token output", async () => {
    const context = buildContext({ jsonMode: true });
    const stdout = captureStdout();
    vi.spyOn(PocketBaseRemoteClient.prototype, "filesToken").mockResolvedValue({
      method: "POST",
      url: "/api/files/token",
      status: 200,
      data: {
        token: "generated-token"
      }
    });

    const command = buildSubcommand(createFilesDefinition(context), "token");

    try {
      await command?.parseAsync(["node", "token"]);
    } finally {
      stdout.restore();
    }

    const rendered = stdout.output.join("").trim();
    const payload = JSON.parse(rendered) as {
      data: {
        data: {
          token: string;
        };
      };
    };

    expect(rendered).not.toContain("generated-token");
    expect(payload.data.data.token).toBe("********");
  });

  it("redacts explicit file tokens from json output", async () => {
    const context = buildContext({ jsonMode: true });
    const stdout = captureStdout();
    const command = buildSubcommand(createFilesDefinition(context), "url");

    try {
      await command?.parseAsync([
        "node",
        "url",
        "users",
        "rec1",
        "avatar.png",
        "--token",
        "secret-token"
      ]);
    } finally {
      stdout.restore();
    }

    const rendered = stdout.output.join("").trim();
    const payload = JSON.parse(rendered) as {
      data: {
        url: string;
        url_with_token: string;
        token: string;
        token_applied: boolean;
        token_source: string;
      };
    };

    expect(rendered).not.toContain("secret-token");
    expect(payload.data.url).not.toContain("token=");
    expect(payload.data.url_with_token).toContain("token=********");
    expect(payload.data.token).toBe("********");
    expect(payload.data.token_applied).toBe(true);
    expect(payload.data.token_source).toBe("provided");
  });

  it("redacts generated file tokens from json output", async () => {
    const context = buildContext({ jsonMode: true });
    const stdout = captureStdout();
    vi.spyOn(PocketBaseRemoteClient.prototype, "filesToken").mockResolvedValue({
      method: "POST",
      url: "/api/files/token",
      status: 200,
      data: {
        token: "generated-token"
      }
    });

    const command = buildSubcommand(createFilesDefinition(context), "url");

    try {
      await command?.parseAsync(["node", "url", "users", "rec1", "avatar.png", "--with-token"]);
    } finally {
      stdout.restore();
    }

    const rendered = stdout.output.join("").trim();
    const payload = JSON.parse(rendered) as {
      data: {
        url: string;
        url_with_token: string;
        token: string;
        token_applied: boolean;
        token_source: string;
      };
    };

    expect(rendered).not.toContain("generated-token");
    expect(payload.data.url).not.toContain("token=");
    expect(payload.data.url_with_token).toContain("token=********");
    expect(payload.data.token).toBe("********");
    expect(payload.data.token_applied).toBe(true);
    expect(payload.data.token_source).toBe("generated");
  });

  it("reveals generated tokens only when --reveal-token is set", async () => {
    const context = buildContext({ jsonMode: true });
    const stdout = captureStdout();
    vi.spyOn(PocketBaseRemoteClient.prototype, "filesToken").mockResolvedValue({
      method: "POST",
      url: "/api/files/token",
      status: 200,
      data: {
        token: "generated-token"
      }
    });

    const command = buildSubcommand(createFilesDefinition(context), "url");

    try {
      await command?.parseAsync([
        "node",
        "url",
        "users",
        "rec1",
        "avatar.png",
        "--with-token",
        "--reveal-token"
      ]);
    } finally {
      stdout.restore();
    }

    const payload = JSON.parse(stdout.output.join("").trim()) as {
      data: {
        url: string;
        url_with_token: string;
        token: string;
        sensitive_output: boolean;
      };
    };

    expect(payload.data.url).toBe("https://pb.example.com/api/files/users/rec1/avatar.png");
    expect(payload.data.url_with_token).toContain("token=generated-token");
    expect(payload.data.token).toBe("generated-token");
    expect(payload.data.sensitive_output).toBe(true);
  });

  it("rejects combining --token and --with-token", async () => {
    const context = buildContext();
    const command = buildSubcommand(createFilesDefinition(context), "url");

    await expect(
      command?.parseAsync([
        "node",
        "url",
        "users",
        "rec1",
        "avatar.png",
        "--token",
        "secret-token",
        "--with-token"
      ])
    ).rejects.toBeInstanceOf(CliExitError);
  });

  it("rejects --reveal-token without a token source", async () => {
    const context = buildContext();
    const command = buildSubcommand(createFilesDefinition(context), "url");

    await expect(
      command?.parseAsync(["node", "url", "users", "rec1", "avatar.png", "--reveal-token"])
    ).rejects.toBeInstanceOf(CliExitError);
  });
});
