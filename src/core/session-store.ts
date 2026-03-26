import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  ConfigKey,
  DEFAULT_SESSION_PATH,
  DEFAULT_STATE_DIR,
  STATE_DIR_ENV
} from "../input/validators";

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

function expandHomePath(value: string): string {
  return value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
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

  public constructor(path?: string) {
    const configuredDir = process.env[STATE_DIR_ENV];
    const baseDir = expandHomePath(configuredDir ?? DEFAULT_STATE_DIR);
    this.path = path ?? join(baseDir, DEFAULT_SESSION_PATH);
  }

  public async load(): Promise<SessionState> {
    try {
      const raw = await readFile(this.path, "utf8");
      const payload = JSON.parse(raw) as unknown;
      return isRecord(payload) ? SessionState.fromJSON(payload) : new SessionState();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return new SessionState();
      }
      if (error instanceof SyntaxError) {
        return new SessionState();
      }
      throw error;
    }
  }

  public async save(state: SessionState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });

    const tempPath = `${this.path}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tempPath, JSON.stringify(state.toJSON(), null, 2), "utf8");

    try {
      await chmod(tempPath, 0o600);
    } catch {
      // Keep best-effort parity with Python implementation without failing the write.
    }

    await rename(tempPath, this.path);

    try {
      await chmod(this.path, 0o600);
    } catch {
      // Keep best-effort parity with Python implementation without failing the write.
    }
  }
}
