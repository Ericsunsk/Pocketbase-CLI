import { createInterface } from "node:readline/promises";
import type { Interface as ReadLineInterface } from "node:readline/promises";
import type { Writable } from "node:stream";

import { AppContext, clearRemoteAuthIfConfigTargetChanged, saveContextState } from "../app/context";
import { CliExitError } from "./output";
import { isConfigKey, parseConfigValue } from "../input/validators";

type WriteTarget = Pick<Writable, "write">;

export type ReplDispatcher = (tokens: string[]) => Promise<void>;
export type ReplReadLine = () => Promise<string>;

const BUILTIN_HELP_LINES = [
  "Built-in REPL commands:",
  "  help                              Show this help",
  "  exit | quit                       Exit REPL",
  "  history                           Show command history",
  "  config show                       Show persisted remote defaults",
  "  config set <key> <value>          Persist remote default value",
  "  config unset <key>                Remove persisted remote default",
  "  undo                              Undo last config set/unset",
  "  redo                              Redo last undone config change"
];

const REMOTE_HELP_EXAMPLES = [
  "  info",
  "  config set base_url https://pb.example.com",
  "  auth login admin@example.com Secret123",
  "  auth status",
  "  auth whoami",
  "  settings get",
  "  settings test-s3 --data '{\"filesystem\":\"storage\"}'",
  "  logs list --per-page 5",
  "  logs stats --filter 'data.status>200'",
  "  crons list",
  "  collections list",
  "  collections scaffolds",
  "  records auth-methods users",
  "  records auth-password users test@example.com Secret123",
  "  records auth-oauth2 users --provider google --code XXX --redirect-url https://app.example.com/callback",
  "  records request-password-reset users test@example.com",
  "  records request-verification users test@example.com",
  "  records impersonate users RECORD_ID",
  "  records list users",
  "  batch run --file requests.json",
  "  files token",
  "  files url users RECORD_ID avatar.png --with-token",
  "  backups list",
  "  backups upload ./snapshot.zip",
  "  backups download nightly.zip --output /tmp/nightly.zip",
  "  backups restore nightly.zip --yes",
  "  raw GET /api/health"
];

const REPL_TOKEN_PATTERN =
  /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/gu;

function buildHelpText(): string {
  return [...BUILTIN_HELP_LINES, "", "PocketBase remote mode examples:", ...REMOTE_HELP_EXAMPLES].join(
    "\n"
  );
}

function stringifyData(data: unknown): string {
  if (data === undefined || data === null) {
    return "";
  }

  if (typeof data === "string") {
    return data;
  }

  return JSON.stringify(data, null, 2);
}

function writeLine(target: WriteTarget, value: string): void {
  target.write(`${value}\n`);
}

export class ReplEofError extends Error {
  public constructor() {
    super("REPL input closed");
  }
}

export function sanitizeHistoryTokens(tokens: string[]): string {
  if (tokens.length === 0) {
    return "";
  }

  if (tokens[0] === "auth" && tokens[1] === "login") {
    if (!tokens.includes("--password-stdin")) {
      const rendered = [...tokens];
      rendered[rendered.length - 1] = "********";
      return rendered.join(" ");
    }
    return tokens.join(" ");
  }

  if (tokens[0] !== "records") {
    if (tokens[0] === "files" && tokens[1] === "url") {
      const rendered = [...tokens];
      for (let index = 0; index < rendered.length - 1; index += 1) {
        if (rendered[index] === "--token") {
          rendered[index + 1] = "********";
        }
      }
      return rendered.join(" ");
    }

    if (tokens[0] === "backups" && tokens[1] === "download") {
      const rendered = [...tokens];
      for (let index = 0; index < rendered.length - 1; index += 1) {
        if (rendered[index] === "--token") {
          rendered[index + 1] = "********";
        }
      }
      return rendered.join(" ");
    }

    return tokens.join(" ");
  }

  const rendered = [...tokens];
  const subcommand = tokens[1];

  if ((subcommand === "auth-password" || subcommand === "auth-otp") && tokens.length >= 5) {
    rendered[rendered.length - 1] = "********";
  } else if (subcommand === "auth-oauth2") {
    for (let index = 0; index < rendered.length - 1; index += 1) {
      if (
        rendered[index] === "--code" ||
        rendered[index] === "--code-verifier" ||
        rendered[index] === "--create-data"
      ) {
        rendered[index + 1] = "********";
      }
    }
  } else if (subcommand === "confirm-password-reset" && tokens.length >= 6) {
    rendered[3] = "********";
    rendered[4] = "********";
    rendered[5] = "********";
  } else if (subcommand === "confirm-verification" && tokens.length >= 4) {
    rendered[3] = "********";
  } else if (subcommand === "confirm-email-change" && tokens.length >= 5) {
    rendered[3] = "********";
    rendered[4] = "********";
  } else {
    return tokens.join(" ");
  }

  return rendered.join(" ");
}

class JsonModeLineReader {
  private readonly iterator: AsyncIterator<string>;
  private buffer = "";

  public constructor() {
    this.iterator = process.stdin[Symbol.asyncIterator]() as AsyncIterator<string>;
  }

  public async nextLine(): Promise<string> {
    for (;;) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex >= 0) {
        const line = this.buffer.slice(0, newlineIndex);
        this.buffer = this.buffer.slice(newlineIndex + 1);
        return line.replace(/\r$/u, "");
      }

      const next = await this.iterator.next();
      if (next.done) {
        if (!this.buffer) {
          throw new ReplEofError();
        }

        const line = this.buffer;
        this.buffer = "";
        return line.replace(/\r$/u, "");
      }

      this.buffer += String(next.value);
    }
  }
}

export class PocketBaseRepl {
  private readonly context: AppContext;
  private readonly dispatch: ReplDispatcher;
  private readonly jsonOutput: boolean;
  private readonly saveState: () => Promise<void>;
  private readonly stdout: WriteTarget;
  private readonly stderr: WriteTarget;
  private readonly readLine?: ReplReadLine;
  private jsonReader?: JsonModeLineReader;
  private interactiveReader?: ReadLineInterface;
  private pendingStateSave = false;

  public constructor(options: {
    context: AppContext;
    dispatch: ReplDispatcher;
    jsonOutput: boolean;
    saveState?: () => Promise<void>;
    stdout?: WriteTarget;
    stderr?: WriteTarget;
    readLine?: ReplReadLine;
  }) {
    this.context = options.context;
    this.dispatch = options.dispatch;
    this.jsonOutput = options.jsonOutput;
    this.saveState = options.saveState ?? ((): Promise<void> => saveContextState(this.context));
    this.stdout = options.stdout ?? process.stdout;
    this.stderr = options.stderr ?? process.stderr;
    this.readLine = options.readLine;
  }

  public async run(): Promise<void> {
    const previousOnStateSaved = this.context.onStateSaved;
    this.context.onStateSaved = (): void => {
      this.pendingStateSave = false;
      previousOnStateSaved?.();
    };

    this.emit({
      ok: true,
      action: "repl.start",
      message: "PocketBase REPL started. Type 'help' for commands.",
      data: { json_mode: this.jsonOutput }
    });

    try {
      for (;;) {
        let line: string;
        try {
          line = await this.readNextLine();
        } catch (error) {
          if (error instanceof ReplEofError) {
            await this.persistStateIfNeeded();
            this.emit({
              ok: true,
              action: "repl.exit",
              message: "Bye."
            });
            return;
          }

          throw error;
        }

        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        const tokens = this.parseLine(trimmed);
        if (!tokens) {
          continue;
        }

        this.context.state.recordCommand(sanitizeHistoryTokens(tokens));
        this.pendingStateSave = true;

        const command = tokens[0];
        if (command === "exit" || command === "quit") {
          await this.persistStateIfNeeded();
          this.emit({
            ok: true,
            action: "repl.exit",
            message: "Bye."
          });
          return;
        }

        if (command === "help" || command === "?") {
          this.emit({
            ok: true,
            action: "help",
            message: buildHelpText()
          });
          await this.persistStateIfNeeded();
          continue;
        }

        if (command === "history") {
          this.emit({
            ok: true,
            action: "history",
            message: "Command history",
            data: { items: this.context.state.commandHistory }
          });
          await this.persistStateIfNeeded();
          continue;
        }

        if (command === "undo") {
          await this.handleUndo();
          await this.persistStateIfNeeded();
          continue;
        }

        if (command === "redo") {
          await this.handleRedo();
          await this.persistStateIfNeeded();
          continue;
        }

        if (command === "config") {
          await this.handleConfig(tokens.slice(1));
          await this.persistStateIfNeeded();
          continue;
        }

        try {
          await this.dispatch(tokens);
        } catch (error) {
          if (error instanceof CliExitError) {
            continue;
          }

          this.emit({
            ok: false,
            action: "repl.dispatch",
            message: error instanceof Error ? error.message : String(error)
          });
        }

        await this.persistStateIfNeeded();
      }
    } finally {
      this.interactiveReader?.close();
      this.interactiveReader = undefined;
      this.context.onStateSaved = previousOnStateSaved;
    }
  }

  private async readNextLine(): Promise<string> {
    if (this.readLine) {
      return this.readLine();
    }

    if (this.jsonOutput) {
      this.jsonReader ??= new JsonModeLineReader();
      return this.jsonReader.nextLine();
    }

    this.interactiveReader ??= createInterface({
      input: process.stdin,
      output: process.stdout
    });

    try {
      return await this.interactiveReader.question("pocketbase> ");
    } catch {
      throw new ReplEofError();
    }
  }

  private parseLine(line: string): string[] | null {
    const tokens: string[] = [];
    REPL_TOKEN_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = REPL_TOKEN_PATTERN.exec(line)) !== null) {
      const value = match[1] ?? match[2] ?? match[3];
      tokens.push(value.replace(/\\(["'])/gu, "$1"));
    }

    if (tokens.length === 0) {
      this.emit({
        ok: false,
        action: "repl.parse",
        message: "Unable to parse REPL input."
      });
      return null;
    }

    return tokens;
  }

  private async persistState(): Promise<void> {
    await this.saveState();
    this.pendingStateSave = false;
  }

  private async persistStateIfNeeded(): Promise<void> {
    if (this.pendingStateSave) {
      await this.persistState();
    }
  }

  private async handleUndo(): Promise<void> {
    try {
      const payload = this.context.state.undo();
      const authChange = clearRemoteAuthIfConfigTargetChanged(this.context);
      await this.persistState();
      this.emit({
        ok: true,
        action: "undo",
        message: authChange.auth_cleared
          ? "Undo applied and saved auth cleared"
          : "Undo applied",
        data: {
          ...payload,
          ...authChange
        }
      });
    } catch (error) {
      this.emit({
        ok: false,
        action: "undo",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async handleRedo(): Promise<void> {
    try {
      const payload = this.context.state.redo();
      const authChange = clearRemoteAuthIfConfigTargetChanged(this.context);
      await this.persistState();
      this.emit({
        ok: true,
        action: "redo",
        message: authChange.auth_cleared
          ? "Redo applied and saved auth cleared"
          : "Redo applied",
        data: {
          ...payload,
          ...authChange
        }
      });
    } catch (error) {
      this.emit({
        ok: false,
        action: "redo",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async handleConfig(tokens: string[]): Promise<void> {
    if (tokens.length === 0 || tokens[0] === "show") {
      this.emit({
        ok: true,
        action: "config.show",
        message: "Current config",
        data: this.context.state.config
      });
      return;
    }

    if (tokens[0] === "set") {
      if (tokens.length < 3) {
        this.emit({
          ok: false,
          action: "config.set",
          message: "Usage: config set <key> <value>"
        });
        return;
      }

      const key = tokens[1];
      const rawValue = tokens.slice(2).join(" ");

      try {
        if (!isConfigKey(key)) {
          throw new Error(`Unknown config key: ${key}`);
        }

        const value = parseConfigValue(key, rawValue);
        const payload = this.context.state.setConfig(key, value);
        const authChange = clearRemoteAuthIfConfigTargetChanged(this.context);
        await this.persistState();
        this.emit({
          ok: true,
          action: "config.set",
          message: authChange.auth_cleared
            ? "Config updated and saved auth cleared"
            : "Config updated",
          data: {
            ...payload,
            ...authChange
          }
        });
      } catch (error) {
        this.emit({
          ok: false,
          action: "config.set",
          message: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (tokens[0] === "unset") {
      if (tokens.length !== 2) {
        this.emit({
          ok: false,
          action: "config.unset",
          message: "Usage: config unset <key>"
        });
        return;
      }

      try {
        const key = tokens[1];
        if (!isConfigKey(key)) {
          throw new Error(`Unknown config key: ${key}`);
        }

        const payload = this.context.state.unsetConfig(key);
        const authChange = clearRemoteAuthIfConfigTargetChanged(this.context);
        await this.persistState();
        this.emit({
          ok: true,
          action: "config.unset",
          message: authChange.auth_cleared
            ? "Config removed and saved auth cleared"
            : "Config removed",
          data: {
            ...payload,
            ...authChange
          }
        });
      } catch (error) {
        this.emit({
          ok: false,
          action: "config.unset",
          message: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    this.emit({
      ok: false,
      action: "config",
      message: "Unknown config command"
    });
  }

  private emit(options: {
    ok: boolean;
    action: string;
    message: string;
    data?: unknown;
  }): void {
    if (this.jsonOutput) {
      const payload: Record<string, unknown> = {
        ok: options.ok,
        action: options.action,
        message: options.message
      };

      if (options.data !== undefined) {
        payload.data = options.data;
      }

      writeLine(this.stdout, JSON.stringify(payload));
      return;
    }

    const target = options.ok ? this.stdout : this.stderr;
    writeLine(target, options.message);

    const rendered = stringifyData(options.data);
    if (rendered) {
      writeLine(target, rendered);
    }
  }
}

export async function startRepl(options: {
  context: AppContext;
  dispatch: ReplDispatcher;
  jsonOutput?: boolean;
}): Promise<void> {
  const repl = new PocketBaseRepl({
    context: options.context,
    dispatch: options.dispatch,
    jsonOutput: options.jsonOutput ?? options.context.jsonMode
  });

  await repl.run();
}
