import { afterEach, describe, expect, it, vi } from "vitest";

import { createCollectionsDefinition } from "../../src/commands/collections";
import { CliExitError } from "../../src/core/output";
import { PocketBaseRemoteClient } from "../../src/http/remote-client";
import { buildSubcommand } from "./helpers/command";
import { makeContext } from "./helpers/context";

function buildContext() {
  return makeContext({
    storePath: "/tmp/pocketbase-cli-collections-session.json",
    baseUrl: "https://pb.example.com",
    authed: true
  });
}

describe("collections commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists collections across all pages", async () => {
    const context = buildContext();
    const spy = vi
      .spyOn(PocketBaseRemoteClient.prototype, "collectionsList")
      .mockResolvedValueOnce({
        method: "GET",
        url: "/api/collections?page=1",
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
        url: "/api/collections?page=2",
        status: 200,
        data: {
          page: 2,
          perPage: 1,
          totalItems: 2,
          totalPages: 2,
          items: [{ id: "b" }]
        }
      });

    const command = buildSubcommand(createCollectionsDefinition(context), "list");

    await command?.parseAsync(["node", "list", "--all"]);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, {
      page: 1,
      perPage: 200,
      filterValue: undefined,
      sort: undefined
    });
  });

  it("creates a collection from --data input", async () => {
    const context = buildContext();
    const spy = vi
      .spyOn(PocketBaseRemoteClient.prototype, "collectionsCreate")
      .mockResolvedValue({
        method: "POST",
        url: "/api/collections",
        status: 200,
        data: {}
      });

    const command = buildSubcommand(createCollectionsDefinition(context), "create");

    await command?.parseAsync(["node", "create", "--data", '{"name":"posts"}']);

    expect(spy).toHaveBeenCalledWith({
      body: {
        name: "posts"
      }
    });
  });

  it("requires --yes before deleting a collection", async () => {
    const context = buildContext();
    const command = buildSubcommand(createCollectionsDefinition(context), "delete");

    await expect(command?.parseAsync(["node", "delete", "posts"])).rejects.toBeInstanceOf(
      CliExitError
    );
  });

  it("updates an existing collection during ensure", async () => {
    const context = buildContext();
    const getSpy = vi
      .spyOn(PocketBaseRemoteClient.prototype, "collectionsGet")
      .mockResolvedValue({
        method: "GET",
        url: "/api/collections/posts",
        status: 200,
        data: {
          id: "col1",
          name: "posts",
          type: "base"
        }
      });
    const updateSpy = vi
      .spyOn(PocketBaseRemoteClient.prototype, "collectionsUpdate")
      .mockResolvedValue({
        method: "PATCH",
        url: "/api/collections/posts",
        status: 200,
        data: {
          id: "col1",
          name: "posts",
          type: "base"
        }
      });

    const command = buildSubcommand(createCollectionsDefinition(context), "ensure");

    await command?.parseAsync(["node", "ensure", "--data", '{"name":"posts"}', "--output", "summary"]);

    expect(getSpy).toHaveBeenCalledWith("posts");
    expect(updateSpy).toHaveBeenCalledWith({
      nameOrId: "posts",
      body: {
        name: "posts"
      }
    });
  });

  it("records bare create history when json input is missing", async () => {
    const context = buildContext();
    const command = buildSubcommand(createCollectionsDefinition(context), "create");

    await expect(command?.parseAsync(["node", "create"])).rejects.toBeInstanceOf(CliExitError);

    expect(context.state.commandHistory.at(-1)).toBe("collections create");
  });

  it("rejects negative collection pagination values", async () => {
    const context = buildContext();
    const spy = vi.spyOn(PocketBaseRemoteClient.prototype, "collectionsList");

    const command = buildSubcommand(createCollectionsDefinition(context), "list");

    await expect(
      command?.parseAsync(["node", "list", "--page", "-1"])
    ).rejects.toBeInstanceOf(CliExitError);

    expect(spy).not.toHaveBeenCalled();
  });
});
