import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadJsonObjectInput } from "../../src/input/json-input";
import { parseBinaryFileInputs } from "../../src/input/record-input";
import { parseBatchPayload } from "../../src/input/remote-payloads";

describe("input helpers", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("rejects combining --file - with --stdin-json", async () => {
    await expect(
      loadJsonObjectInput({
        filePath: "-",
        stdinJson: true,
        action: "batch.run"
      })
    ).rejects.toThrow("requires exactly one");
  });

  it("preserves = characters in binary upload paths", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "pocketbase-cli-input-"));
    tempDirs.push(tempDir);
    const filePath = join(tempDir, "avatar=a.png");
    await writeFile(filePath, "demo");

    await expect(
      parseBinaryFileInputs({
        binaryFiles: [`avatar=${filePath}`],
        action: "records.create"
      })
    ).resolves.toEqual([
      {
        fieldName: "avatar",
        filePath
      }
    ]);
  });

  it("normalizes validated batch request methods and urls", () => {
    const payload = parseBatchPayload({
      requests: [
        {
          method: " post ",
          url: " /api/collections/posts/records ",
          body: {
            title: "hello"
          }
        }
      ]
    }) as {
      requests: Array<{ method: string; url: string }>;
    };

    expect(payload.requests[0]).toMatchObject({
      method: "POST",
      url: "/api/collections/posts/records"
    });
  });
});
