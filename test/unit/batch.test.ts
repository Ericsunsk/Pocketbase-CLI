import { afterEach, describe, expect, it, vi } from "vitest";

import { createBatchDefinition } from "../../src/commands/batch";
import { CliExitError } from "../../src/core/output";
import { PocketBaseRemoteClient } from "../../src/http/remote-client";
import { buildSubcommand } from "./helpers/command";
import { makeContext } from "./helpers/context";

function buildContext() {
  return makeContext({
    storePath: "/tmp/pocketbase-cli-batch-session.json",
    baseUrl: "https://pb.example.com",
    authed: true
  });
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

    const command = buildSubcommand(createBatchDefinition(context), "run");

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

    const command = buildSubcommand(createBatchDefinition(context), "run");

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
