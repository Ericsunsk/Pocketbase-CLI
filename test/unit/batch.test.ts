import { afterEach, describe, expect, it, vi } from "vitest";

import { createBatchDefinition } from "../../src/commands/batch";
import { CliExitError } from "../../src/core/output";
import { PocketBaseRemoteClient } from "../../src/http/remote-client";
import { SessionState, SessionStore } from "../../src/core/session-store";

function buildContext() {
  const store = new SessionStore("/tmp/pocketbase-cli-batch-session.json");
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

describe("batch commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs a valid batch payload", async () => {
    const context = buildContext();
    const spy = vi.spyOn(PocketBaseRemoteClient.prototype, "batchRun").mockResolvedValue({
      method: "POST",
      url: "/api/batch",
      status: 200,
      data: {}
    });

    const definition = createBatchDefinition(context);
    const runDefinition = definition.children?.find((child) => child.name === "run");
    const command = runDefinition?.build?.();

    await command?.parseAsync([
      "node",
      "run",
      "--data",
      '{"requests":[{"method":"POST","url":"/api/collections/posts/records","body":{"title":"hello"}}]}'
    ]);

    expect(spy).toHaveBeenCalledWith({
      body: {
        requests: [
          {
            method: "POST",
            url: "/api/collections/posts/records",
            body: {
              title: "hello"
            }
          }
        ]
      }
    });
  });

  it("rejects unsupported batch request URLs", async () => {
    const context = buildContext();
    const spy = vi.spyOn(PocketBaseRemoteClient.prototype, "batchRun");

    const definition = createBatchDefinition(context);
    const runDefinition = definition.children?.find((child) => child.name === "run");
    const command = runDefinition?.build?.();

    await expect(
      command?.parseAsync([
        "node",
        "run",
        "--data",
        '{"requests":[{"method":"GET","url":"/api/settings"}]}'
      ])
    ).rejects.toBeInstanceOf(CliExitError);

    expect(spy).not.toHaveBeenCalled();
  });
});
