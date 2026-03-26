import { describe, expect, it } from "vitest";

import {
  buildErrorEnvelope,
  buildSuccessEnvelope,
  SCHEMA_VERSION
} from "../../src/core/output";

describe("output envelope", () => {
  it("builds success payload with http and pagination metadata", () => {
    const payload = buildSuccessEnvelope({
      action: "records.list",
      message: "ok",
      data: {
        method: "GET",
        url: "https://pb.example.com/api/collections/users/records?page=1",
        status: 200,
        data: {
          page: 1,
          perPage: 20,
          totalItems: 1,
          totalPages: 1,
          items: [{ id: "rec_1" }]
        }
      }
    });

    expect(payload.ok).toBe(true);
    expect(payload.schema_version).toBe(SCHEMA_VERSION);
    expect(payload.http).toEqual({
      method: "GET",
      url: "https://pb.example.com/api/collections/users/records?page=1",
      status: 200
    });
    expect(payload.pagination).toMatchObject({
      page: 1,
      total_items: 1,
      item_count: 1,
      has_more: false
    });
  });

  it("builds error payload with inferred type", () => {
    const payload = buildErrorEnvelope({
      action: "raw",
      message: "Base URL is required. Run `config set base_url <url>` first.",
      missingPrerequisite: "base_url"
    });

    expect(payload.ok).toBe(false);
    expect(payload.error.type).toBe("missing_prerequisite");
    expect(payload.error.missing_prerequisite).toBe("base_url");
  });
});
