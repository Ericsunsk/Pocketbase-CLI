import { describe, expect, it } from "vitest";

import { PocketBaseRemoteClient, PocketBaseRemoteError } from "../../src/http/remote-client";

describe("PocketBaseRemoteClient", () => {
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
});
