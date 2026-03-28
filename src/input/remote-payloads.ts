const BATCH_ALLOWED_PATTERNS = new Map<string, RegExp>([
  ["POST", /^\/api\/collections\/[^/?]+\/records(\?.*)?$/u],
  ["PUT", /^\/api\/collections\/[^/?]+\/records(\?.*)?$/u],
  ["PATCH", /^\/api\/collections\/[^/?]+\/records\/[^/?]+(\?.*)?$/u],
  ["DELETE", /^\/api\/collections\/[^/?]+\/records\/[^/?]+(\?.*)?$/u]
]);

export function parseCollectionsImportPayload(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const collections = payload.collections;
  if (!Array.isArray(collections) || collections.length === 0) {
    throw new Error(
      "Collections import payload must contain a non-empty `collections` array"
    );
  }

  return payload;
}

export function parseCollectionEnsurePayload(payload: Record<string, unknown>): {
  body: Record<string, unknown>;
  lookupName: string;
} {
  const name = payload.name;
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("collections.ensure payload must include a non-empty `name`");
  }

  const lookupName = name.trim();

  return {
    body: {
      ...payload,
      name: lookupName
    },
    lookupName
  };
}

export function parseBatchPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const requests = payload.requests;
  if (!Array.isArray(requests) || requests.length === 0) {
    throw new Error("Batch payload must contain a non-empty `requests` array");
  }

  for (const [index, item] of requests.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Batch request ${index} must be an object`);
    }

    const record = item as Record<string, unknown>;
    const method = record.method;
    const url = record.url;

    if (typeof method !== "string" || !method.trim()) {
      throw new Error(`Batch request ${index} must include a string \`method\``);
    }

    if (typeof url !== "string" || !url.trim()) {
      throw new Error(`Batch request ${index} must include a string \`url\``);
    }

    const normalizedMethod = method.trim().toUpperCase();
    const normalizedUrl = url.trim();
    const allowedPattern = BATCH_ALLOWED_PATTERNS.get(normalizedMethod);
    if (!allowedPattern || !allowedPattern.test(normalizedUrl)) {
      throw new Error(
        `Batch request ${index} must target one of the supported record actions: POST/PUT /api/collections/<collection>/records, PATCH/DELETE /api/collections/<collection>/records/<id>`
      );
    }

    record.method = normalizedMethod;
    record.url = normalizedUrl;

    const body = record.body;
    if (body !== undefined && (body === null || typeof body !== "object" || Array.isArray(body))) {
      throw new Error(`Batch request ${index} \`body\` must be a JSON object when provided`);
    }

    const headers = record.headers;
    if (headers !== undefined) {
      if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
        throw new Error(`Batch request ${index} \`headers\` must be an object when provided`);
      }

      for (const [key, value] of Object.entries(headers)) {
        if (typeof key !== "string" || typeof value !== "string") {
          throw new Error(`Batch request ${index} \`headers\` keys and values must be strings`);
        }
      }
    }
  }

  return payload;
}
