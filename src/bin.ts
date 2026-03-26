#!/usr/bin/env node

import { createCli } from "./cli";
import { createAppContext } from "./app/context";
import { CliExitError } from "./core/output";

async function main(): Promise<void> {
  const context = await createAppContext();
  const cli = createCli(context);

  try {
    await cli.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof CliExitError) {
      process.exitCode = error.code;
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error("pocketbase-cli:", message);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("pocketbase-cli:", message);
  process.exit(1);
});
