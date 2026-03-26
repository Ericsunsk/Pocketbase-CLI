import { Command } from "commander";

import { AppContext, recordCommand } from "../app/context";
import type { CommandDefinition } from "../contract/command-registry";
import { requireConfirmation, runRemoteAction } from "./support";

export function createCronsDefinition(context: AppContext): CommandDefinition {
  return {
    name: "crons",
    path: "crons",
    kind: "group",
    summary: "Remote cron endpoints",
    authRequired: true,
    destructive: false,
    confirmationRequired: false,
    children: [
      {
        name: "list",
        path: "crons.list",
        kind: "command",
        summary: "List cron jobs",
        authRequired: true,
        destructive: false,
        confirmationRequired: false,
        build: () =>
          new Command("list")
            .description("List cron jobs")
            .action(async () => {
              await recordCommand(context, "crons list");
              await runRemoteAction(context, {
                action: "crons.list",
                successMessage: "Crons list completed",
                operation: (client) => client.cronsList()
              });
            })
      },
      {
        name: "run",
        path: "crons.run",
        kind: "command",
        summary: "Run a cron job",
        authRequired: true,
        destructive: true,
        confirmationRequired: true,
        confirmationFlag: "--yes",
        parameters: [
          {
            kind: "argument",
            name: "job_id",
            required: true,
            nargs: 1,
            type: "TEXT"
          },
          {
            kind: "option",
            name: "--yes",
            names: ["--yes"],
            required: false,
            takes_value: false,
            is_flag: true,
            nargs: 1,
            type: "BOOLEAN"
          }
        ],
        build: () =>
          new Command("run")
            .description("Run a cron job now")
            .argument("<job_id>")
            .option(
              "--yes",
              "Acknowledge that running a cron job can trigger side effects immediately"
            )
            .action(async (jobId: string, options: { yes?: boolean }) => {
              requireConfirmation(context, {
                action: "crons.run",
                yes: Boolean(options.yes),
                message:
                  "Cron run can trigger side effects immediately. Re-run with `--yes` to continue.",
                hint:
                  "Re-run `crons run <job_id> --yes` after confirming the job should execute now."
              });

              await recordCommand(context, `crons run ${jobId} --yes`);
              await runRemoteAction(context, {
                action: "crons.run",
                successMessage: "Cron run completed",
                operation: (client) => client.cronsRun(jobId)
              });
            })
      }
    ],
    build: () => new Command("crons").description("Remote cron endpoints")
  };
}
