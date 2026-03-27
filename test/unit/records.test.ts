import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createRecordsDefinition } from "../../src/commands/records";
import { CliExitError } from "../../src/core/output";
import { PocketBaseRemoteClient } from "../../src/http/remote-client";
import { SessionState, SessionStore } from "../../src/core/session-store";

function buildContext(options?: { jsonMode?: boolean }) {
  const store = new SessionStore("/tmp/pocketbase-cli-records-session.json");
  const state = new SessionState();
  state.setConfig("base_url", "https://pb.example.com");
  state.setRemoteAuth({
    baseUrl: "https://pb.example.com/",
    token: "token"
  });

  return {
    version: "0.1.0",
    jsonMode: options?.jsonMode ?? false,
    store,
    state
  };
}

function buildUnauthedContext(options?: { jsonMode?: boolean }) {
  const store = new SessionStore("/tmp/pocketbase-cli-records-session-unauthed.json");
  const state = new SessionState();
  state.setConfig("base_url", "https://pb.example.com");

  return {
    version: "0.1.0",
    jsonMode: options?.jsonMode ?? false,
    store,
    state
  };
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

    const definition = createRecordsDefinition(context);
    const listDefinition = definition.children?.find((child) => child.name === "list");
    const command = listDefinition?.build?.();

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

    const definition = createRecordsDefinition(context);
    const getDefinition = definition.children?.find((child) => child.name === "get");
    const command = getDefinition?.build?.();

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

    const definition = createRecordsDefinition(context);
    const createDefinition = definition.children?.find((child) => child.name === "create");
    const command = createDefinition?.build?.();

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

    const definition = createRecordsDefinition(context);
    const upsertDefinition = definition.children?.find((child) => child.name === "upsert");
    const command = upsertDefinition?.build?.();

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

    const definition = createRecordsDefinition(context);
    const updateDefinition = definition.children?.find((child) => child.name === "update");
    const command = updateDefinition?.build?.();

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
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
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

    const definition = createRecordsDefinition(context);
    const findDefinition = definition.children?.find((child) => child.name === "find");
    const command = findDefinition?.build?.();

    await command?.parseAsync(["node", "find", "posts", "--filter", 'title = "hello"', "--first"]);

    const payload = JSON.parse(String(stdoutSpy.mock.calls.at(-1)?.[0] ?? "").trim()) as {
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

    const definition = createRecordsDefinition(context);
    const deleteByFilterDefinition = definition.children?.find(
      (child) => child.name === "delete-by-filter"
    );
    const command = deleteByFilterDefinition?.build?.();

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

    const definition = createRecordsDefinition(context);
    const authMethodsDefinition = definition.children?.find(
      (child) => child.name === "auth-methods"
    );
    const command = authMethodsDefinition?.build?.();

    await command?.parseAsync(["node", "auth-methods", "users"]);

    expect(spy).toHaveBeenCalledWith("users");
  });

  it("saves auth state after records.auth-password succeeds", async () => {
    const context = buildUnauthedContext();
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

    const definition = createRecordsDefinition(context);
    const authPasswordDefinition = definition.children?.find(
      (child) => child.name === "auth-password"
    );
    const command = authPasswordDefinition?.build?.();

    await command?.parseAsync(["node", "auth-password", "users", "alice@example.com", "Secret123"]);

    expect(context.state.remoteAuth.token).toBe("new-token");
    expect(context.state.remoteAuth.collection).toBe("users");
    expect(context.state.remoteAuth.record).toEqual({
      id: "user1"
    });
  });

  it("requires --yes before deleting a record", async () => {
    const context = buildContext();
    const definition = createRecordsDefinition(context);
    const deleteDefinition = definition.children?.find((child) => child.name === "delete");
    const command = deleteDefinition?.build?.();

    await expect(command?.parseAsync(["node", "delete", "posts", "rec1"])).rejects.toBeInstanceOf(
      CliExitError
    );
  });

  it("rejects records.create when neither JSON nor binary input is provided", async () => {
    const context = buildContext();
    const definition = createRecordsDefinition(context);
    const createDefinition = definition.children?.find((child) => child.name === "create");
    const command = createDefinition?.build?.();

    await expect(command?.parseAsync(["node", "create", "posts"])).rejects.toBeInstanceOf(
      CliExitError
    );
  });

  it("rejects invalid delete-by-filter expect-count values before deleting", async () => {
    const context = buildContext();
    const listSpy = vi.spyOn(PocketBaseRemoteClient.prototype, "recordsList");
    const deleteSpy = vi.spyOn(PocketBaseRemoteClient.prototype, "recordsDelete");

    const definition = createRecordsDefinition(context);
    const deleteDefinition = definition.children?.find((child) => child.name === "delete-by-filter");
    const command = deleteDefinition?.build?.();

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
});
