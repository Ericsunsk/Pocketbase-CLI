import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
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
const SESSION_LOCK_TIMEOUT_MS = 5_000;
const SESSION_LOCK_POLL_MS = 25;
const SESSION_LOCK_STALE_MS = 30_000;
const SESSION_LOCK_HEARTBEAT_MS = 5_000;

interface SessionLockOwnerRecord {
  id: string;
  pid: number;
  heartbeat_at: number;
}

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

function deepClone<T>(value: T): T {
  if (value === undefined) {
    return value;
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneSnapshot(snapshot: SessionSnapshot): SessionSnapshot {
  return {
    config: { ...snapshot.config },
    remote_auth: deepClone(snapshot.remote_auth),
    command_history: [...snapshot.command_history],
    undo_stack: deepClone(snapshot.undo_stack),
    redo_stack: deepClone(snapshot.redo_stack)
  };
}

function areSameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function findSequenceOverlap<T>(base: T[], current: T[]): number {
  const maxOverlap = Math.min(base.length, current.length);

  for (let overlap = maxOverlap; overlap >= 0; overlap -= 1) {
    const baseSlice = base.slice(base.length - overlap);
    const currentSlice = current.slice(0, overlap);

    if (areSameValue(baseSlice, currentSlice)) {
      return overlap;
    }
  }

  return 0;
}

function trimCommandHistory(history: string[], maxHistory: number): string[] {
  const overflow = history.length - maxHistory;
  return overflow > 0 ? history.slice(overflow) : [...history];
}

function mergeConfigState(
  base: SessionConfigState,
  latest: SessionConfigState,
  current: SessionConfigState
): SessionConfigState {
  const merged: SessionConfigState = {};
  const keys = new Set([...Object.keys(base), ...Object.keys(latest), ...Object.keys(current)]);

  for (const rawKey of keys) {
    const key = rawKey as keyof SessionConfigState;
    const baseValue = base[key];
    const latestValue = latest[key];
    const currentValue = current[key];
    const mergedValue = areSameValue(currentValue, baseValue) ? latestValue : currentValue;

    if (mergedValue !== undefined && mergedValue !== null) {
      merged[key] = mergedValue as never;
    }
  }

  return merged;
}

function mergeRemoteAuthState(
  base: RemoteAuthState,
  latest: RemoteAuthState,
  current: RemoteAuthState
): RemoteAuthState {
  return areSameValue(current, base) ? deepClone(latest) : deepClone(current);
}

function mergeCommandHistory(
  base: string[],
  latest: string[],
  current: string[],
  maxHistory: number
): string[] {
  if (areSameValue(current, base)) {
    return trimCommandHistory(latest, maxHistory);
  }

  const overlap = findSequenceOverlap(base, current);
  const localAppends = current.slice(overlap);

  if (localAppends.length === 0) {
    return trimCommandHistory(latest, maxHistory);
  }

  return trimCommandHistory([...latest, ...localAppends], maxHistory);
}

function mergeChangeStack(
  base: Array<Record<string, unknown>>,
  latest: Array<Record<string, unknown>>,
  current: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  if (areSameValue(current, base)) {
    return deepClone(latest);
  }

  if (
    current.length >= base.length &&
    areSameValue(current.slice(0, base.length), base)
  ) {
    return [...deepClone(latest), ...deepClone(current.slice(base.length))];
  }

  return deepClone(current);
}

function mergeSessionSnapshots(options: {
  base: SessionSnapshot;
  latest: SessionSnapshot;
  current: SessionSnapshot;
  maxHistory: number;
}): SessionSnapshot {
  return {
    config: mergeConfigState(options.base.config, options.latest.config, options.current.config),
    remote_auth: mergeRemoteAuthState(
      options.base.remote_auth,
      options.latest.remote_auth,
      options.current.remote_auth
    ),
    command_history: mergeCommandHistory(
      options.base.command_history,
      options.latest.command_history,
      options.current.command_history,
      options.maxHistory
    ),
    undo_stack: mergeChangeStack(
      options.base.undo_stack,
      options.latest.undo_stack,
      options.current.undo_stack
    ),
    redo_stack: mergeChangeStack(
      options.base.redo_stack,
      options.latest.redo_stack,
      options.current.redo_stack
    )
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SessionState {
  public config: SessionConfigState;
  public remoteAuth: RemoteAuthState;
  public commandHistory: string[];
  public undoStack: Array<Record<string, unknown>>;
  public redoStack: Array<Record<string, unknown>>;
  public readonly maxHistory: number;
  private persistedSnapshot: SessionSnapshot;

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
    this.persistedSnapshot = this.toJSON();
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
    return cloneSnapshot({
      config: { ...this.config },
      remote_auth: deepClone(this.remoteAuth),
      command_history: [...this.commandHistory],
      undo_stack: deepClone(this.undoStack),
      redo_stack: deepClone(this.redoStack)
    });
  }

  public getPersistedSnapshot(): SessionSnapshot {
    return cloneSnapshot(this.persistedSnapshot);
  }

  public replaceWithSnapshot(snapshot: SessionSnapshot): void {
    this.config = { ...snapshot.config };
    this.remoteAuth = deepClone(snapshot.remote_auth);
    this.commandHistory = [...snapshot.command_history];
    this.undoStack = deepClone(snapshot.undo_stack);
    this.redoStack = deepClone(snapshot.redo_stack);
    this.persistedSnapshot = cloneSnapshot(snapshot);
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
  private readonly lockPath: string;
  private readonly lockOwnerPath: string;

  public constructor(path?: string) {
    const configuredDir = process.env[STATE_DIR_ENV];
    const baseDir = expandHomePath(configuredDir ?? DEFAULT_STATE_DIR);
    this.path = path ?? join(baseDir, DEFAULT_SESSION_PATH);
    this.keyPath = `${this.path}.key`;
    this.lockPath = `${this.path}.lock`;
    this.lockOwnerPath = join(this.lockPath, "owner.json");
  }

  public async load(): Promise<SessionState> {
    return this.readStateFromDisk();
  }

  public async save(state: SessionState): Promise<void> {
    await this.withLock(async () => {
      const key = await this.loadEncryptionKey(true);
      const latest = await this.readStateFromDisk();
      const merged = mergeSessionSnapshots({
        base: state.getPersistedSnapshot(),
        latest: latest.toJSON(),
        current: state.toJSON(),
        maxHistory: state.maxHistory
      });
      const encrypted = encryptSessionSnapshot(merged, key);

      await writePrivateFileAtomic(this.path, JSON.stringify(encrypted, null, 2));
      state.replaceWithSnapshot(merged);
    });
  }

  private async readStateFromDisk(): Promise<SessionState> {
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

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const ownerId = await this.acquireLock();
    const stopHeartbeat = this.startLockHeartbeat(ownerId);

    try {
      return await operation();
    } finally {
      stopHeartbeat();
      await this.releaseLock(ownerId);
    }
  }

  private async acquireLock(): Promise<string> {
    await mkdir(dirname(this.path), { recursive: true });

    const startedAt = Date.now();

    for (;;) {
      try {
        await mkdir(this.lockPath);
        const ownerId = `${process.pid}-${Date.now()}-${randomBytes(8).toString("hex")}`;

        try {
          await this.writeLockOwner(ownerId);
        } catch (error) {
          await rm(this.lockPath, {
            recursive: true,
            force: true
          });
          throw error;
        }

        return ownerId;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error;
        }

        if (await this.clearStaleLock()) {
          continue;
        }

        if (Date.now() - startedAt >= SESSION_LOCK_TIMEOUT_MS) {
          throw new Error(`Timed out acquiring session lock at ${this.lockPath}.`);
        }

        await delay(SESSION_LOCK_POLL_MS);
      }
    }
  }

  private async clearStaleLock(): Promise<boolean> {
    try {
      const lockStats = await stat(this.lockPath);
      const ownerStats = await stat(this.lockOwnerPath).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }

        throw error;
      });
      const lastHeartbeatMs = ownerStats?.mtimeMs ?? lockStats.mtimeMs;

      if (Date.now() - lastHeartbeatMs < SESSION_LOCK_STALE_MS) {
        return false;
      }

      await rm(this.lockPath, {
        recursive: true,
        force: true
      });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return true;
      }

      throw error;
    }
  }

  private async releaseLock(ownerId: string): Promise<void> {
    const ownerRecord = await this.readLockOwner().catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }

      throw error;
    });

    if (!ownerRecord || ownerRecord.id !== ownerId) {
      return;
    }

    await rm(this.lockPath, {
      recursive: true,
      force: true
    });
  }

  private startLockHeartbeat(ownerId: string): () => void {
    const timer = setInterval(() => {
      void this.writeLockOwner(ownerId).catch(() => {
        // The owner may have already released or lost the lock.
      });
    }, SESSION_LOCK_HEARTBEAT_MS);

    timer.unref?.();

    return (): void => {
      clearInterval(timer);
    };
  }

  private async writeLockOwner(ownerId: string): Promise<void> {
    const payload: SessionLockOwnerRecord = {
      id: ownerId,
      pid: process.pid,
      heartbeat_at: Date.now()
    };

    await writeFile(this.lockOwnerPath, JSON.stringify(payload), {
      encoding: "utf8",
      mode: 0o600
    });
  }

  private async readLockOwner(): Promise<SessionLockOwnerRecord | null> {
    const raw = await readFile(this.lockOwnerPath, "utf8");
    const payload = JSON.parse(raw) as unknown;

    if (
      !isRecord(payload) ||
      typeof payload.id !== "string" ||
      typeof payload.pid !== "number" ||
      typeof payload.heartbeat_at !== "number"
    ) {
      return null;
    }

    return {
      id: payload.id,
      pid: payload.pid,
      heartbeat_at: payload.heartbeat_at
    };
  }
}
