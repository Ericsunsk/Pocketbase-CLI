export const STATE_DIR_ENV = "POCKETBASE_CLI_STATE_DIR";
export const BASE_URL_ENV = "POCKETBASE_CLI_BASE_URL";
export const AUTH_IDENTITY_ENV = "POCKETBASE_CLI_AUTH_IDENTITY";
export const AUTH_PASSWORD_ENV = "POCKETBASE_CLI_AUTH_PASSWORD";
export const DEFAULT_STATE_DIR = "~/.cache/pocketbase-cli";
export const DEFAULT_SESSION_PATH = "session.json";

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
    return raw.replace(/\/+$/, "");
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

function readOptionalTrimmedEnv(
  key: string,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const raw = env[key];
  if (typeof raw !== "string") {
    return null;
  }

  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

export function readEnvConfig(env: NodeJS.ProcessEnv = process.env): {
  base_url?: string | null;
  auth_identity?: string | null;
  auth_password?: string | null;
} {
  const baseUrl = readEnvBaseUrl(env);
  const authIdentity = readOptionalTrimmedEnv(AUTH_IDENTITY_ENV, env);
  const authPassword = readOptionalTrimmedEnv(AUTH_PASSWORD_ENV, env);

  return {
    ...(baseUrl ? { base_url: baseUrl } : {}),
    ...(authIdentity ? { auth_identity: authIdentity } : {}),
    ...(authPassword ? { auth_password: authPassword } : {})
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
