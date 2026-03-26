import { Command, CommanderError } from "commander";
import { AppContext } from "./app/context";
import { buildCommandDefinitions } from "./commands";
import { registerCommandDefinitions } from "./contract/command-registry";
import { emitError } from "./core/output";
import { startRepl } from "./core/repl";

const REPL_DISPATCH_CLI_CACHE = new WeakMap<AppContext, Command>();

const REPL_ROOT_COMMANDS = new Set([
  "repl",
  "info",
  "schema",
  "raw",
  "config",
  "auth",
  "settings",
  "logs",
  "crons",
  "collections",
  "files",
  "backups",
  "records",
  "batch",
  "undo",
  "redo",
  "history"
]);

function inferReplAction(tokens: string[]): string {
  if (tokens.length === 0) {
    return "repl.dispatch";
  }

  if (tokens.length === 1) {
    return tokens[0];
  }

  return `${tokens[0]}.${tokens[1]}`;
}

async function dispatchReplTokens(context: AppContext, tokens: string[]): Promise<void> {
  if (tokens[0] === "repl") {
    throw new Error("Nested REPL sessions are not supported.");
  }

  if (!REPL_ROOT_COMMANDS.has(tokens[0])) {
    emitError({
      jsonOutput: context.jsonMode,
      action: "repl.dispatch",
      message: `Unknown command: ${tokens[0]}`
    });
  }

  let cli = REPL_DISPATCH_CLI_CACHE.get(context);
  if (!cli) {
    cli = createCli(context, { launchReplOnEmpty: false });
    cli.exitOverride();
    REPL_DISPATCH_CLI_CACHE.set(context, cli);
  }

  context.suppressHistory = true;

  try {
    const argv = context.jsonMode ? ["--json", ...tokens] : tokens;
    await cli.parseAsync(argv, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      emitError({
        jsonOutput: context.jsonMode,
        action: inferReplAction(tokens),
        message: error.message,
        errorType: "usage_error"
      });
    }

    throw error;
  } finally {
    context.suppressHistory = false;
  }
}

async function runCliRepl(context: AppContext): Promise<void> {
  await startRepl({
    context,
    dispatch: async (tokens) => {
      await dispatchReplTokens(context, tokens);
    }
  });
}

export function createCli(
  context: AppContext,
  options?: {
    launchReplOnEmpty?: boolean;
  }
): Command {
  const launchReplOnEmpty = options?.launchReplOnEmpty ?? true;
  const initialJsonMode = context.jsonMode;
  const program = new Command("pocketbase-cli")
    .description("Remote-only PocketBase CLI for deployed PocketBase instances")
    .showHelpAfterError()
    .option("--json", "output JSON")
    .hook("preAction", () => {
      context.jsonMode = program.opts().json ?? initialJsonMode;
    });

  registerCommandDefinitions(
    program,
    buildCommandDefinitions(context, {
      runRepl: async () => {
        await runCliRepl(context);
      }
    })
  );

  program.action(async () => {
    if (!program.args?.length) {
      if (launchReplOnEmpty) {
        await runCliRepl(context);
        return;
      }

      await program.outputHelp();
    }
  });

  return program;
}
