import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createRecordsDefinition } from "../../src/commands/records";
import { CliExitError } from "../../src/core/output";
import { PocketBaseRemoteClient } from "../../src/http/remote-client";
import { buildSubcommand } from "./helpers/command";
import { makeContext } from "./helpers/context";
import { captureStdout } from "./helpers/output";

function buildContext(options?: { jsonMode?: boolean; authCollection?: string }) {
  return makeContext({
    storePath: "/tmp/pocketbase-cli-records-session.json",
    jsonMode: options?.jsonMode ?? false,
    baseUrl: "https://pb.example.com",
    authed: true,
    authCollection: options?.authCollection
  });
}

function buildUnauthedContext(options?: { jsonMode?: boolean }) {
  return makeContext({
    storePath: "/tmp/pocketbase-cli-records-session-unauthed.json",
    jsonMode: options?.jsonMode ?? false,
    baseUrl: "https://pb.example.com"
  });
}

describe("records commands", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("lists records across all pages", async () => {
    const context = buildContext();
    const spy = vi
      .spyOn(PocketBaseRemoteClient.prototype, "recordsList")
      .mockResolvedValueOnce({
        method: "GET",
        url: "/api/collections/posts/records?page=1",
        status: 200,
        data: {
          page: 1,
          perPage: 1,
          totalItems: 2,
          totalPages: 2,
          items: [{ id: "a" }]
        }
      })
      .mockResolvedValueOnce({
        method: "GET",
        url: "/api/collections/posts/records?page=2",
        status: 200,
        data: {
          page: 2,
          perPage: 1,
          totalItems: 2,
          totalPages: 2,
          items: [{ id: "b" }]
        }
      });

    const command = buildSubcommand(createRecordsDefinition(context), "list");

    await command?.parseAsync(["node", "list", "posts", "--all"]);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, {
      collection: "posts",
      page: 1,
      perPage: 200,
      filterValue: undefined,
      sort: undefined,
      fields: undefined,
      expand: undefined
    });
  });

  it("fetches a single record", async () => {
    const context = buildContext();
    const spy = vi
      .spyOn(PocketBaseRemoteClient.prototype, "recordsGet")
      .mockResolvedValue({
        method: "GET",
        url: "/api/collections/posts/records/rec1",
        status: 200,
        data: {}
      });

    const command = buildSubcommand(createRecordsDefinition(context), "get");

    await command?.parseAsync(["node", "get", "posts", "rec1", "--fields", "id,title"]);

    expect(spy).toHaveBeenCalledWith({
      collection: "posts",
      recordId: "rec1",
      fields: "id,title",
      expand: undefined
    });
  });

  it("creates a record with binary files and no JSON body", async () => {
    const context = buildContext();
    const tempDir = await mkdtemp(join(tmpdir(), "pocketbase-cli-records-"));
    tempDirs.push(tempDir);
    const avatarPath = join(tempDir, "avatar.png");
    await writeFile(avatarPath, new Uint8Array([1, 2, 3]));

    const spy = vi
      .spyOn(PocketBaseRemoteClient.prototype, "recordsCreateWithFiles")
      .mockResolvedValue({
        method: "POST",
        url: "/api/collections/posts/records",
        status: 200,
        data: {}
      });

    const command = buildSubcommand(createRecordsDefinition(context), "create");

    await command?.parseAsync([
      "node",
      "create",
      "posts",
      "--binary-file",
      `avatar=${avatarPath}`
    ]);

    expect(spy).toHaveBeenCalledWith({
      collection: "posts",
      body: {},
      fileFields: [
        {
          fieldName: "avatar",
          filePath: avatarPath
        }
      ]
    });
  });

  it("upserts by creating when the filter matches no records", async () => {
    const context = buildContext();
    vi.spyOn(PocketBaseRemoteClient.prototype, "recordsList").mockResolvedValue({
      method: "GET",
      url: "/api/collections/posts/records?page=1",
      status: 200,
      data: {
        page: 1,
        perPage: 2,
        totalItems: 0,
        totalPages: 1,
        items: []
      }
    });
    const createSpy = vi
      .spyOn(PocketBaseRemoteClient.prototype, "recordsCreate")
      .mockResolvedValue({
        method: "POST",
        url: "/api/collections/posts/records",
        status: 200,
        data: {}
      });

    const command = buildSubcommand(createRecordsDefinition(context), "upsert");

    await command?.parseAsync([
      "node",
      "upsert",
      "posts",
      "--filter",
      'slug = "hello"',
      "--data",
      '{"title":"hello"}'
    ]);

    expect(createSpy).toHaveBeenCalledWith({
      collection: "posts",
      body: {
        title: "hello"
      }
    });
  });

  it("updates a record with JSON and binary file input", async () => {
    const context = buildContext();
    const tempDir = await mkdtemp(join(tmpdir(), "pocketbase-cli-records-"));
    tempDirs.push(tempDir);
    const attachmentPath = join(tempDir, "attachment.txt");
    await writeFile(attachmentPath, "hello");

    const spy = vi
      .spyOn(PocketBaseRemoteClient.prototype, "recordsUpdateWithFiles")
      .mockResolvedValue({
        method: "PATCH",
        url: "/api/collections/posts/records/rec1",
        status: 200,
        data: {}
      });

    const command = buildSubcommand(createRecordsDefinition(context), "update");

    await command?.parseAsync([
      "node",
      "update",
      "posts",
      "rec1",
      "--data",
      '{"title":"hello"}',
      "--binary-file",
      `attachment=${attachmentPath}`
    ]);

    expect(spy).toHaveBeenCalledWith({
      collection: "posts",
      recordId: "rec1",
      body: {
        title: "hello"
      },
      fileFields: [
        {
          fieldName: "attachment",
          filePath: attachmentPath
        }
      ]
    });
  });

  it("renders the custom records.find JSON envelope", async () => {
    const context = buildContext({
      jsonMode: true
    });
    const stdout = captureStdout();
    vi.spyOn(PocketBaseRemoteClient.prototype, "recordsList").mockResolvedValue({
      method: "GET",
      url: "/api/collections/posts/records?page=1",
      status: 200,
      data: {
        page: 1,
        perPage: 1,
        totalItems: 1,
        totalPages: 1,
        items: [{ id: "rec1", title: "hello" }]
      }
    });

    const command = buildSubcommand(createRecordsDefinition(context), "find");

    try {
      await command?.parseAsync([
        "node",
        "find",
        "posts",
        "--filter",
        'title = "hello"',
        "--first"
      ]);
    } finally {
      stdout.restore();
    }

    const payload = JSON.parse(stdout.output.join("").trim()) as {
      data: {
        collection: string;
        filter: string;
        matched_count: number;
        found: boolean;
        record: { id: string; title: string } | null;
        items: Array<{ id: string }>;
      };
    };

    expect(payload.data.collection).toBe("posts");
    expect(payload.data.filter).toBe('title = "hello"');
    expect(payload.data.matched_count).toBe(1);
    expect(payload.data.found).toBe(true);
    expect(payload.data.record).toEqual({ id: "rec1", title: "hello" });
    expect(payload.data.items).toEqual([{ id: "rec1", title: "hello" }]);
  });

  it("deletes records matched by filter", async () => {
    const context = buildContext();
    vi.spyOn(PocketBaseRemoteClient.prototype, "recordsList").mockResolvedValue({
      method: "GET",
      url: "/api/collections/posts/records?page=1",
      status: 200,
      data: {
        page: 1,
        perPage: 2,
        totalItems: 2,
        totalPages: 1,
        items: [{ id: "a" }, { id: "b" }]
      }
    });
    const deleteSpy = vi
      .spyOn(PocketBaseRemoteClient.prototype, "recordsDelete")
      .mockResolvedValue({
        method: "DELETE",
        url: "/api/collections/posts/records/a",
        status: 200,
        data: {}
      });

    const command = buildSubcommand(createRecordsDefinition(context), "delete-by-filter");

    await command?.parseAsync([
      "node",
      "delete-by-filter",
      "posts",
      "--filter",
      'status = "inactive"',
      "--yes"
    ]);

    expect(deleteSpy).toHaveBeenCalledTimes(2);
    expect(deleteSpy).toHaveBeenNthCalledWith(1, {
      collection: "posts",
      recordId: "a"
    });
    expect(deleteSpy).toHaveBeenNthCalledWith(2, {
      collection: "posts",
      recordId: "b"
    });
  });

  it("fetches auth methods without requiring an existing session", async () => {
    const context = buildUnauthedContext();
    const spy = vi
      .spyOn(PocketBaseRemoteClient.prototype, "recordAuthMethods")
      .mockResolvedValue({
        method: "GET",
        url: "/api/collections/users/auth-methods",
        status: 200,
        data: {}
      });

    const command = buildSubcommand(createRecordsDefinition(context), "auth-methods");

    await command?.parseAsync(["node", "auth-methods", "users"]);

    expect(spy).toHaveBeenCalledWith("users");
  });

  it("saves auth state after records.auth-password succeeds", async () => {
    const context = buildUnauthedContext({
      jsonMode: true
    });
    const stdout = captureStdout();
    vi.spyOn(PocketBaseRemoteClient.prototype, "recordAuthPassword").mockResolvedValue({
      method: "POST",
      url: "/api/collections/users/auth-with-password",
      status: 200,
      data: {
        token: "new-token",
        record: {
          id: "user1"
        }
      }
    });

    const command = buildSubcommand(createRecordsDefinition(context), "auth-password");

    try {
      await command?.parseAsync([
        "node",
        "auth-password",
        "users",
        "alice@example.com",
        "Secret123"
      ]);
    } finally {
      stdout.restore();
    }

    expect(context.state.remoteAuth.token).toBe("new-token");
    expect(context.state.remoteAuth.collection).toBe("users");
    expect(context.state.remoteAuth.record).toEqual({
      id: "user1"
    });

    const payload = JSON.parse(stdout.output.join("").trim()) as {
      data: {
        data: {
          token: string;
          record: {
            id: string;
          };
        };
      };
    };

    expect(payload.data.data.token).toBe("********");
    expect(payload.data.data.record).toEqual({
      id: "user1"
    });
  });

  it("requests password reset without requiring an existing session", async () => {
    const context = buildUnauthedContext();
    const spy = vi
      .spyOn(PocketBaseRemoteClient.prototype, "recordRequestPasswordReset")
      .mockResolvedValue({
        method: "POST",
        url: "/api/collections/users/request-password-reset",
        status: 200,
        data: {}
      });

    const command = buildSubcommand(createRecordsDefinition(context), "request-password-reset");

    await command?.parseAsync(["node", "request-password-reset", "users", "alice@example.com"]);

    expect(spy).toHaveBeenCalledWith({
      collection: "users",
      email: "alice@example.com"
    });
  });

  it("redacts confirm-password-reset history while preserving payload", async () => {
    const context = buildUnauthedContext();
    const spy = vi
      .spyOn(PocketBaseRemoteClient.prototype, "recordConfirmPasswordReset")
      .mockResolvedValue({
        method: "POST",
        url: "/api/collections/users/confirm-password-reset",
        status: 200,
        data: {}
      });

    const command = buildSubcommand(createRecordsDefinition(context), "confirm-password-reset");

    await command?.parseAsync([
      "node",
      "confirm-password-reset",
      "users",
      "reset-token",
      "Secret123",
      "Secret123"
    ]);

    expect(spy).toHaveBeenCalledWith({
      collection: "users",
      token: "reset-token",
      password: "Secret123",
      passwordConfirm: "Secret123"
    });
    expect(context.state.commandHistory.at(-1)).toBe(
      "records confirm-password-reset users ******** ******** ********"
    );
  });

  it("does not overwrite saved auth on auth-refresh --no-save", async () => {
    const context = buildContext({ authCollection: "users" });
    vi.spyOn(PocketBaseRemoteClient.prototype, "recordAuthRefresh").mockResolvedValue({
      method: "POST",
      url: "/api/collections/users/auth-refresh",
      status: 200,
      data: {
        token: "next-token",
        record: {
          id: "user2"
        }
      }
    });

    const command = buildSubcommand(createRecordsDefinition(context), "auth-refresh");

    await command?.parseAsync(["node", "auth-refresh", "users", "--no-save"]);

    expect(context.state.remoteAuth.token).toBe("token");
    expect(context.state.commandHistory.at(-1)).toBe("records auth-refresh users --no-save");
  });

  it("rejects auth-refresh when saved auth collection does not match the requested collection", async () => {
    const context = buildContext();
    const spy = vi.spyOn(PocketBaseRemoteClient.prototype, "recordAuthRefresh");

    const command = buildSubcommand(createRecordsDefinition(context), "auth-refresh");

    await expect(
      command?.parseAsync(["node", "auth-refresh", "users"])
    ).rejects.toBeInstanceOf(CliExitError);

    expect(spy).not.toHaveBeenCalled();
  });

  it("redacts oauth2 codes in history and parses create-data payload", async () => {
    const context = buildUnauthedContext();
    const spy = vi.spyOn(PocketBaseRemoteClient.prototype, "recordAuthOauth2").mockResolvedValue({
      method: "POST",
      url: "/api/collections/users/auth-with-oauth2",
      status: 200,
      data: {
        token: "oauth-token",
        record: {
          id: "user3"
        }
      }
    });

    const command = buildSubcommand(createRecordsDefinition(context), "auth-oauth2");

    await command?.parseAsync([
      "node",
      "auth-oauth2",
      "users",
      "--provider",
      "google",
      "--code",
      "AUTH_CODE",
      "--redirect-url",
      "https://app.example.com/callback",
      "--code-verifier",
      "VERIFIER",
      "--create-data",
      '{"locale":"zh-CN"}',
      "--fields",
      "id",
      "--expand",
      "profile",
      "--no-save"
    ]);

    expect(spy).toHaveBeenCalledWith({
      collection: "users",
      provider: "google",
      code: "AUTH_CODE",
      redirectUrl: "https://app.example.com/callback",
      codeVerifier: "VERIFIER",
      createData: {
        locale: "zh-CN"
      },
      fields: "id",
      expand: "profile"
    });
    expect(context.state.commandHistory.at(-1)).toBe(
      "records auth-oauth2 users --provider google --code ******** --redirect-url https://app.example.com/callback --code-verifier ******** --create-data <json> --fields id --expand profile --no-save"
    );
    expect(context.state.remoteAuth.token).toBeUndefined();
  });

  it("requires --yes before deleting a record", async () => {
    const context = buildContext();
    const command = buildSubcommand(createRecordsDefinition(context), "delete");

    await expect(command?.parseAsync(["node", "delete", "posts", "rec1"])).rejects.toBeInstanceOf(
      CliExitError
    );
  });

  it("rejects records.create when neither JSON nor binary input is provided", async () => {
    const context = buildContext();
    const command = buildSubcommand(createRecordsDefinition(context), "create");

    await expect(command?.parseAsync(["node", "create", "posts"])).rejects.toBeInstanceOf(
      CliExitError
    );
  });

  it("rejects invalid delete-by-filter expect-count values before deleting", async () => {
    const context = buildContext();
    const listSpy = vi.spyOn(PocketBaseRemoteClient.prototype, "recordsList");
    const deleteSpy = vi.spyOn(PocketBaseRemoteClient.prototype, "recordsDelete");

    const command = buildSubcommand(createRecordsDefinition(context), "delete-by-filter");

    await expect(
      command?.parseAsync([
        "node",
        "delete-by-filter",
        "posts",
        "--filter",
        'status = "inactive"',
        "--expect-count",
        "1foo",
        "--yes"
      ])
    ).rejects.toBeInstanceOf(CliExitError);

    expect(listSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("rejects non-positive impersonation duration values", async () => {
    const context = buildContext();
    const spy = vi.spyOn(PocketBaseRemoteClient.prototype, "recordImpersonate");

    const command = buildSubcommand(createRecordsDefinition(context), "impersonate");

    await expect(
      command?.parseAsync([
        "node",
        "impersonate",
        "users",
        "rec1",
        "--duration",
        "0"
      ])
    ).rejects.toBeInstanceOf(CliExitError);

    expect(spy).not.toHaveBeenCalled();
  });
});
