import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  ConfigKey,
  DEFAULT_SESSION_PATH,
  DEFAULT_STATE_DIR,
  STATE_DIR_ENV
} from "../input/validators";

const SESSION_ENCRYPTION_FORMAT = "pocketbase-cli.session.encrypted/v1";
const SESSION_ENCRYPTION_ALGORITHM = "aes-256-gcm";
const SESSION_ENCRYPTION_KEY_BYTES = 32;
const SESSION_ENCRYPTION_IV_BYTES = 12;
const SESSION_ENCRYPTION_TAG_BYTES = 16;

export interface RemoteAuthState {
  base_url?: string;
  token?: string;
  record?: Record<string, unknown>;
  collection?: string;
}

export interface SessionConfigState {
  base_url?: string | null;
  auth_collection?: string | null;
  timeout?: number | null;
}

export interface SessionSnapshot {
  config: SessionConfigState;
  remote_auth: RemoteAuthState;
  command_history: string[];
  undo_stack: Array<Record<string, unknown>>;
  redo_stack: Array<Record<string, unknown>>;
}

interface EncryptedSessionEnvelope {
  format: string;
  algorithm: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

function expandHomePath(value: string): string {
  return value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
}

function isEncryptedSessionEnvelope(value: unknown): value is EncryptedSessionEnvelope {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.format === SESSION_ENCRYPTION_FORMAT &&
    typeof value.algorithm === "string" &&
    typeof value.iv === "string" &&
    typeof value.tag === "string" &&
    typeof value.ciphertext === "string"
  );
}

function decodeBase64Field(name: string, value: string, expectedLength?: number): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 0 || (expectedLength !== undefined && decoded.length !== expectedLength)) {
    throw new Error(`Invalid ${name} in encrypted session state.`);
  }

  return decoded;
}

function encryptSessionSnapshot(snapshot: SessionSnapshot, key: Buffer): EncryptedSessionEnvelope {
  const iv = randomBytes(SESSION_ENCRYPTION_IV_BYTES);
  const cipher = createCipheriv(SESSION_ENCRYPTION_ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(snapshot), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    format: SESSION_ENCRYPTION_FORMAT,
    algorithm: SESSION_ENCRYPTION_ALGORITHM,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
}

function decryptSessionEnvelope(path: string, envelope: EncryptedSessionEnvelope, key: Buffer): SessionState {
  if (envelope.algorithm !== SESSION_ENCRYPTION_ALGORITHM) {
    throw new Error(
      `Failed to decrypt session state at ${path}. Unsupported encryption algorithm: ${envelope.algorithm}.`
    );
  }

  try {
    const iv = decodeBase64Field("IV", envelope.iv, SESSION_ENCRYPTION_IV_BYTES);
    const tag = decodeBase64Field("auth tag", envelope.tag, SESSION_ENCRYPTION_TAG_BYTES);
    const ciphertext = decodeBase64Field("ciphertext", envelope.ciphertext);
    const decipher = createDecipheriv(SESSION_ENCRYPTION_ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const payload = JSON.parse(plaintext) as unknown;
    return isRecord(payload) ? SessionState.fromJSON(payload) : new SessionState();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse decrypted session state at ${path}.`);
    }

    throw new Error(
      `Failed to decrypt session state at ${path}. ` +
        `Delete both the session file and its key file if you want to start with a clean state.`
    );
  }
}

async function writePrivateFileAtomic(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });

  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, data, {
    encoding: "utf8",
    mode: 0o600
  });

  await rename(tempPath, path);

  try {
    await chmod(path, 0o600);
  } catch {
    // Keep best-effort parity across platforms without failing the write.
  }
}

export class SessionState {
  public config: SessionConfigState;
  public remoteAuth: RemoteAuthState;
  public commandHistory: string[];
  public undoStack: Array<Record<string, unknown>>;
  public redoStack: Array<Record<string, unknown>>;
  public readonly maxHistory: number;

  public constructor(options?: {
    config?: SessionConfigState;
    remoteAuth?: RemoteAuthState;
    commandHistory?: string[];
    undoStack?: Array<Record<string, unknown>>;
    redoStack?: Array<Record<string, unknown>>;
    maxHistory?: number;
  }) {
    this.config = { ...(options?.config ?? {}) };
    this.remoteAuth = { ...(options?.remoteAuth ?? {}) };
    this.commandHistory = [...(options?.commandHistory ?? [])];
    this.undoStack = [...(options?.undoStack ?? [])];
    this.redoStack = [...(options?.redoStack ?? [])];
    this.maxHistory = options?.maxHistory ?? 200;
  }

  public recordCommand(commandLine: string): void {
    const normalized = commandLine.trim();
    if (!normalized) {
      return;
    }

    this.commandHistory.push(normalized);
    const overflow = this.commandHistory.length - this.maxHistory;
    if (overflow > 0) {
      this.commandHistory.splice(0, overflow);
    }
  }

  public setConfig(key: ConfigKey, value: string | number | null): Record<string, unknown> {
    const oldValue = this.config[key] ?? null;
    if (oldValue === value) {
      return {
        changed: false,
        key,
        old: oldValue,
        new: value
      };
    }

    const change = {
      key,
      old: oldValue,
      new: value
    };

    if (value === null) {
      delete this.config[key];
    } else {
      this.config[key] = value as never;
    }

    this.undoStack.push(change);
    this.redoStack = [];

    return {
      changed: true,
      ...change
    };
  }

  public unsetConfig(key: ConfigKey): Record<string, unknown> {
    return this.setConfig(key, null);
  }

  public undo(): Record<string, unknown> {
    const change = this.undoStack.pop();
    if (!change) {
      throw new Error("Nothing to undo");
    }

    const key = change.key as ConfigKey;
    const oldValue = (change.old ?? null) as string | number | null;

    if (oldValue === null) {
      delete this.config[key];
    } else {
      this.config[key] = oldValue as never;
    }

    this.redoStack.push(change);

    return {
      key,
      value: oldValue,
      change
    };
  }

  public redo(): Record<string, unknown> {
    const change = this.redoStack.pop();
    if (!change) {
      throw new Error("Nothing to redo");
    }

    const key = change.key as ConfigKey;
    const newValue = (change.new ?? null) as string | number | null;

    if (newValue === null) {
      delete this.config[key];
    } else {
      this.config[key] = newValue as never;
    }

    this.undoStack.push(change);

    return {
      key,
      value: newValue,
      change
    };
  }

  public setRemoteAuth(options: {
    baseUrl: string;
    token: string;
    record?: Record<string, unknown> | null;
    collection?: string;
  }): RemoteAuthState {
    this.remoteAuth = {
      base_url: options.baseUrl.replace(/\/+$/, ""),
      token: options.token,
      record: { ...(options.record ?? {}) },
      collection: options.collection ?? "_superusers"
    };

    return { ...this.remoteAuth };
  }

  public clearRemoteAuth(): void {
    this.remoteAuth = {};
  }

  public hasRemoteAuth(): boolean {
    return Boolean(this.remoteAuth.base_url && this.remoteAuth.token);
  }

  public toJSON(): SessionSnapshot {
    return {
      config: { ...this.config },
      remote_auth: { ...this.remoteAuth },
      command_history: [...this.commandHistory],
      undo_stack: [...this.undoStack],
      redo_stack: [...this.redoStack]
    };
  }

  public static fromJSON(raw: Record<string, unknown>): SessionState {
    return new SessionState({
      config: isRecord(raw.config) ? (raw.config as SessionConfigState) : {},
      remoteAuth: isRecord(raw.remote_auth) ? (raw.remote_auth as RemoteAuthState) : {},
      commandHistory: Array.isArray(raw.command_history)
        ? raw.command_history.map(String)
        : [],
      undoStack: Array.isArray(raw.undo_stack)
        ? raw.undo_stack.filter(isRecord)
        : [],
      redoStack: Array.isArray(raw.redo_stack)
        ? raw.redo_stack.filter(isRecord)
        : []
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export class SessionStore {
  public readonly path: string;
  public readonly keyPath: string;

  public constructor(path?: string) {
    const configuredDir = process.env[STATE_DIR_ENV];
    const baseDir = expandHomePath(configuredDir ?? DEFAULT_STATE_DIR);
    this.path = path ?? join(baseDir, DEFAULT_SESSION_PATH);
    this.keyPath = `${this.path}.key`;
  }

  public async load(): Promise<SessionState> {
    try {
      const raw = await readFile(this.path, "utf8");
      const payload = JSON.parse(raw) as unknown;
      if (!isRecord(payload)) {
        return new SessionState();
      }

      if (isEncryptedSessionEnvelope(payload)) {
        const key = await this.loadEncryptionKey(false);
        return decryptSessionEnvelope(this.path, payload, key);
      }

      return SessionState.fromJSON(payload);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return new SessionState();
      }
      if (error instanceof SyntaxError) {
        throw new Error(
          `Failed to parse session state at ${this.path}. Fix or remove the corrupted file and try again.`
        );
      }
      throw error;
    }
  }

  public async save(state: SessionState): Promise<void> {
    const key = await this.loadEncryptionKey(true);
    const encrypted = encryptSessionSnapshot(state.toJSON(), key);
    await writePrivateFileAtomic(this.path, JSON.stringify(encrypted, null, 2));
  }

  private async loadEncryptionKey(createIfMissing: boolean): Promise<Buffer> {
    try {
      const raw = (await readFile(this.keyPath, "utf8")).trim();
      return decodeBase64Field("encryption key", raw, SESSION_ENCRYPTION_KEY_BYTES);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }

      if (!createIfMissing) {
        throw new Error(
          `Failed to decrypt session state at ${this.path}. Missing encryption key at ${this.keyPath}.`
        );
      }
    }

    const key = randomBytes(SESSION_ENCRYPTION_KEY_BYTES);
    await writePrivateFileAtomic(this.keyPath, key.toString("base64"));
    return key;
  }
}
