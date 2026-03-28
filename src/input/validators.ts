export const STATE_DIR_ENV = "POCKETBASE_CLI_STATE_DIR";
export const BASE_URL_ENV = "POCKETBASE_CLI_BASE_URL";
export const DEFAULT_STATE_DIR = "~/.cache/pocketbase-cli";
export const DEFAULT_SESSION_PATH = "session.json";
const ALLOWED_BASE_URL_PROTOCOLS = new Set(["http:", "https:"]);

export const INT_CONFIG_KEYS = new Set(["timeout"]);
export const ALLOWED_CONFIG_KEYS = new Set([
  "base_url",
  "auth_collection",
  "timeout"
] as const);

export type ConfigKey = "base_url" | "auth_collection" | "timeout";

export function isConfigKey(value: string): value is ConfigKey {
  return ALLOWED_CONFIG_KEYS.has(value as ConfigKey);
}

export function parseBaseUrlValue(name: string, raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`${name} expects a non-empty URL`);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${name} expects an absolute http:// or https:// URL`);
  }

  if (!ALLOWED_BASE_URL_PROTOCOLS.has(parsed.protocol) || !parsed.hostname) {
    throw new Error(`${name} expects an absolute http:// or https:// URL`);
  }

  if (parsed.username || parsed.password) {
    throw new Error(`${name} must not include embedded credentials`);
  }

  if (parsed.search || parsed.hash) {
    throw new Error(`${name} must not include query parameters or fragments`);
  }

  const pathname = parsed.pathname.replace(/\/+$/u, "");
  return `${parsed.origin}${pathname === "/" ? "" : pathname}`;
}

export function parseConfigValue(key: string, raw: string): string | number | null {
  if (!isConfigKey(key)) {
    throw new Error(`Unknown config key: ${key}`);
  }

  const lowered = raw.trim().toLowerCase();
  if (lowered === "none" || lowered === "null" || lowered === "unset") {
    return null;
  }

  if (INT_CONFIG_KEYS.has(key)) {
    return parseIntegerOptionValue(key, raw);
  }

  if (key === "base_url") {
    return parseBaseUrlValue("base_url", raw);
  }

  return raw.trim();
}

export function readEnvBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env[BASE_URL_ENV];
  if (typeof raw !== "string") {
    return null;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = parseConfigValue("base_url", trimmed);
  return typeof parsed === "string" ? parsed : null;
}

export function readEnvConfig(env: NodeJS.ProcessEnv = process.env): {
  base_url?: string | null;
} {
  const baseUrl = readEnvBaseUrl(env);

  return {
    ...(baseUrl ? { base_url: baseUrl } : {})
  };
}

export function quoteForHistory(value: string): string {
  if (!value || /[\s"'\\]/u.test(value)) {
    return `'${value.replace(/'/gu, `'\\''`)}'`;
  }

  return value;
}

export function parseIntegerOptionValue(name: string, raw: string): number {
  const trimmed = raw.trim();
  if (!/^-?\d+$/u.test(trimmed)) {
    throw new Error(`${name} expects an integer value`);
  }

  const value = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} expects an integer value`);
  }

  return value;
}
