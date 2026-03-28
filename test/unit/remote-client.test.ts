import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CLI_USER_AGENT } from "../../src/core/version";
import { PocketBaseRemoteClient, PocketBaseRemoteError } from "../../src/http/remote-client";

async function readStreamBytes(stream: ReadableStream<Uint8Array>): Promise<number[]> {
  const reader = stream.getReader();
  const chunks: number[] = [];

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        return chunks;
      }

      chunks.push(...Array.from(value));
    }
  } finally {
    reader.releaseLock();
  }
}

describe("PocketBaseRemoteClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("builds query strings compatibly", () => {
    const client = new PocketBaseRemoteClient({
      baseUrl: "https://pb.example.com",
      timeout: 5
    });

    expect(
      client.buildUrl("/api/collections", {
        page: 1,
        filter: 'name = "users"'
      })
    ).toBe("https://pb.example.com/api/collections?page=1&filter=name+%3D+%22users%22");
  });

  it("builds file urls compatibly", () => {
    const client = new PocketBaseRemoteClient({
      baseUrl: "https://pb.example.com"
    });

    expect(
      client.buildFileUrl({
        collection: "users",
        recordId: "rec_1",
        filename: "avatar image.png",
        thumb: "100x100",
        download: true,
        token: "file-token"
      })
    ).toBe(
      "https://pb.example.com/api/files/users/rec_1/avatar%20image.png?thumb=100x100&download=1&token=file-token"
    );
  });

  it("builds backup urls compatibly", () => {
    const client = new PocketBaseRemoteClient({
      baseUrl: "https://pb.example.com"
    });

    expect(
      client.buildBackupUrl({
        name: "@nightly backup.zip",
        token: "file-token"
      })
    ).toBe("https://pb.example.com/api/backups/%40nightly%20backup.zip?token=file-token");
  });

  it("throws a 401 error when auth is required and no token exists", async () => {
    const client = new PocketBaseRemoteClient({
      baseUrl: "https://pb.example.com"
    });

    await expect(
      client.request("GET", "/api/collections", {
        requireAuth: true
      })
    ).rejects.toBeInstanceOf(PocketBaseRemoteError);
  });

  it("only attaches Authorization when includeAuth is enabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => "{}"
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new PocketBaseRemoteClient({
      baseUrl: "https://pb.example.com",
      token: "secret-token"
    });

    await client.request("GET", "/api/health", {
      requireAuth: false
    });
    await client.request("GET", "/api/health", {
      requireAuth: false,
      includeAuth: true
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.not.objectContaining({
        Authorization: "secret-token"
      })
    });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        Authorization: "secret-token"
      })
    });
  });

  it("merges list and record query parameters for recordsList", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => '{"items":[]}'
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new PocketBaseRemoteClient({
      baseUrl: "https://pb.example.com",
      token: "secret-token"
    });

    await client.recordsList({
      collection: "posts",
      page: 2,
      perPage: 50,
      filterValue: 'status = "published"',
      sort: "-created",
      fields: "id,title",
      expand: "author"
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://pb.example.com/api/collections/posts/records?page=2&perPage=50&filter=status+%3D+%22published%22&sort=-created&fields=id%2Ctitle&expand=author"
    );
  });

  it("streams backup downloads with binary accept headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        }
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new PocketBaseRemoteClient({
      baseUrl: "https://pb.example.com",
      token: "secret-token"
    });

    const result = await client.backupsDownload({
      name: "nightly.zip",
      token: "file-token"
    });

    expect(await readStreamBytes(result.data)).toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledWith(
        "https://pb.example.com/api/backups/nightly.zip?token=file-token",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Accept: "*/*",
            "User-Agent": CLI_USER_AGENT
          })
        })
      );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.not.objectContaining({
        Authorization: "secret-token"
      })
    });
  });

  it("wraps binary endpoint failures as PocketBaseRemoteError", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => '{"message":"boom"}'
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new PocketBaseRemoteClient({
      baseUrl: "https://pb.example.com"
    });

    await expect(
      client.backupsDownload({
        name: "nightly.zip",
        token: "file-token"
      })
    ).rejects.toMatchObject({
      message: "boom",
      status: 500,
      url: "https://pb.example.com/api/backups/nightly.zip?token=file-token"
    });
  });

  it("redacts token query parameters in serialized remote errors", () => {
    const error = new PocketBaseRemoteError({
      method: "GET",
      url: "https://pb.example.com/api/backups/nightly.zip?token=file-token",
      status: 500,
      message: "boom",
      data: {
        token: "secret-token",
        nested: {
          smtpPassword: "Secret123",
          signedUrl: "https://pb.example.com/api/files/users/rec1/avatar.png?token=file-token"
        }
      }
    });

    expect((error.toJSON().url as string)).toContain("token=********");
    expect(error.toJSON().data).toEqual({
      token: "********",
      nested: {
        smtpPassword: "********",
        signedUrl: "https://pb.example.com/api/files/users/rec1/avatar.png?token=********"
      }
    });
  });

  it("streams multipart backup uploads", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "pocketbase-cli-remote-client-"));
    const archivePath = join(tempDir, "snapshot.zip");
    await writeFile(archivePath, "zip-bytes");

    try {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => "{}"
      });
      vi.stubGlobal("fetch", fetchMock);

      const client = new PocketBaseRemoteClient({
        baseUrl: "https://pb.example.com",
        token: "secret-token"
      });

      await client.backupsUpload({
        filePath: archivePath
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://pb.example.com/api/backups/upload",
        expect.objectContaining({
          method: "POST",
          duplex: "half",
          headers: expect.objectContaining({
            "Content-Type": expect.stringContaining("multipart/form-data; boundary="),
            Authorization: "secret-token"
          })
        })
      );
      expect(typeof fetchMock.mock.calls[0]?.[1]?.body?.[Symbol.asyncIterator]).toBe("function");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
