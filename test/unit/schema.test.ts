import { describe, expect, it } from "vitest";

import { buildCommandDefinitions } from "../../src/commands";
import { normalizeSchemaPath } from "../../src/contract/command-registry";
import { buildSchemaContract, findSchemaEntry } from "../../src/contract/schema";
import { SessionState, SessionStore } from "../../src/core/session-store";

describe("schema contract", () => {
  const context = {
    version: "0.1.0",
    jsonMode: true,
    store: new SessionStore("/tmp/pocketbase-cli-test-session.json"),
    state: new SessionState()
  };
  const definitions = buildCommandDefinitions(context);

  it("normalizes schema paths compatibly", () => {
    expect(normalizeSchemaPath(" records.list ")).toBe("records list");
    expect(normalizeSchemaPath("records   list")).toBe("records list");
  });

  it("builds a contract for implemented commands", () => {
    const contract = buildSchemaContract(definitions);
    const commands = contract.commands as Array<{
      path: string;
      options?: Array<{ name: string; help?: string; conflicts_with?: string[]; choices?: string[] }>;
      input_schema?: Record<string, unknown> | null;
      examples?: string[];
    }>;

    expect(contract.schema_version).toBe("1.1.0");
    expect(commands.some((command) => command.path === "repl")).toBe(true);
    expect(commands.some((command) => command.path === "preflight")).toBe(true);
    expect(commands.some((command) => command.path === "config.set")).toBe(true);
    expect(commands.some((command) => command.path === "auth.status")).toBe(true);

    const raw = commands.find((command) => command.path === "raw");
    expect(raw?.examples?.length).toBeGreaterThan(0);
    expect(raw?.input_schema).toMatchObject({
      type: "object"
    });
    expect(raw?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "--data",
          help: expect.stringContaining("json object body"),
          conflicts_with: ["--file", "--stdin-json"]
        })
      ])
    );

    const ensure = commands.find((command) => command.path === "collections.ensure");
    expect(ensure?.input_schema).toMatchObject({
      required: ["name"]
    });
    expect(ensure?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "--if-exists",
          choices: ["update", "fail"]
        })
      ])
    );
  });

  it("finds entries by normalized path", () => {
    const entry = findSchemaEntry(definitions, "config set");

    expect(entry?.path).toBe("config.set");
  });

  it("keeps the visible contract stable when include-hidden is requested", () => {
    const contract = buildSchemaContract(definitions, true);
    const commands = contract.commands as Array<{ path: string }>;

    expect(commands.some((command) => command.path === "records")).toBe(true);
    expect(commands.some((command) => command.path === "remote.records")).toBe(false);
    expect(findSchemaEntry(definitions, "records", true)?.path).toBe("records");
  });
});
