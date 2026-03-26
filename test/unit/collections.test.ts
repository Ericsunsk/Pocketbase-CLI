import { afterEach, describe, expect, it, vi } from "vitest";

import { createCollectionsDefinition } from "../../src/commands/collections";
import { CliExitError } from "../../src/core/output";
import { PocketBaseRemoteClient } from "../../src/http/remote-client";
import { SessionState, SessionStore } from "../../src/core/session-store";

function buildContext() {
  const store = new SessionStore("/tmp/pocketbase-cli-collections-session.json");
  const state = new SessionState();
  state.setConfig("base_url", "https://pb.example.com");
  state.setRemoteAuth({
    baseUrl: "https://pb.example.com/",
    token: "token"
  });

  return {
    version: "0.1.0",
    jsonMode: false,
    store,
    state
  };
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

    const definition = createCollectionsDefinition(context);
    const listDefinition = definition.children?.find((child) => child.name === "list");
    const command = listDefinition?.build?.();

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

    const definition = createCollectionsDefinition(context);
    const createDefinition = definition.children?.find((child) => child.name === "create");
    const command = createDefinition?.build?.();

    await command?.parseAsync(["node", "create", "--data", '{"name":"posts"}']);

    expect(spy).toHaveBeenCalledWith({
      body: {
        name: "posts"
      }
    });
  });

  it("requires --yes before deleting a collection", async () => {
    const context = buildContext();
    const definition = createCollectionsDefinition(context);
    const deleteDefinition = definition.children?.find((child) => child.name === "delete");
    const command = deleteDefinition?.build?.();

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

    const definition = createCollectionsDefinition(context);
    const ensureDefinition = definition.children?.find((child) => child.name === "ensure");
    const command = ensureDefinition?.build?.();

    await command?.parseAsync(["node", "ensure", "--data", '{"name":"posts"}', "--output", "summary"]);

    expect(getSpy).toHaveBeenCalledWith("posts");
    expect(updateSpy).toHaveBeenCalledWith({
      nameOrId: "posts",
      body: {
        name: "posts"
      }
    });
  });
});
