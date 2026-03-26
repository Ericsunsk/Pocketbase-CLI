import { Command } from "commander";

import { AppContext, recordCommand } from "../app/context";
import type { CommandDefinition } from "../contract/command-registry";
import { emitError, emitSuccess } from "../core/output";
import { isConfigKey, parseConfigValue, quoteForHistory } from "../input/validators";

function createConfigShowCommand(context: AppContext): CommandDefinition {
  return {
    name: "show",
    path: "config.show",
    kind: "command",
    summary: "Show persisted remote defaults",
    authRequired: false,
    destructive: false,
    confirmationRequired: false,
    parameters: [],
    build: () =>
      new Command("show")
        .description("Show persisted remote defaults")
        .action(() => {
          emitSuccess({
            jsonOutput: context.jsonMode,
            action: "config.show",
            message: "Current config",
            data: context.state.config
          });
        })
  };
}

function createConfigSetCommand(context: AppContext): CommandDefinition {
  return {
    name: "set",
    path: "config.set",
    kind: "command",
    summary: "Persist remote default value",
    authRequired: false,
    destructive: false,
    confirmationRequired: false,
    parameters: [
      {
        kind: "argument",
        name: "key",
        required: true,
        nargs: 1,
        type: "TEXT"
      },
      {
        kind: "argument",
        name: "value",
        required: true,
        nargs: 1,
        type: "TEXT"
      }
    ],
    build: () =>
      new Command("set")
        .description("Persist remote default value")
        .argument("<key>")
        .argument("<value>")
        .action(async (key: string, value: string) => {
          if (!isConfigKey(key)) {
            emitError({
              jsonOutput: context.jsonMode,
              action: "config.set",
              message: `Unknown config key: ${key}`
            });
          }

          let parsed: string | number | null;
          try {
            parsed = parseConfigValue(key, value);
          } catch (error) {
            emitError({
              jsonOutput: context.jsonMode,
              action: "config.set",
              message: error instanceof Error ? error.message : String(error)
            });
          }

          const payload = context.state.setConfig(key, parsed);
          await recordCommand(context, `config set ${key} ${quoteForHistory(value)}`);

          emitSuccess({
            jsonOutput: context.jsonMode,
            action: "config.set",
            message: "Config updated",
            data: payload
          });
        })
  };
}

function createConfigUnsetCommand(context: AppContext): CommandDefinition {
  return {
    name: "unset",
    path: "config.unset",
    kind: "command",
    summary: "Remove persisted remote default",
    authRequired: false,
    destructive: false,
    confirmationRequired: false,
    parameters: [
      {
        kind: "argument",
        name: "key",
        required: true,
        nargs: 1,
        type: "TEXT"
      }
    ],
    build: () =>
      new Command("unset")
        .description("Remove persisted remote default")
        .argument("<key>")
        .action(async (key: string) => {
          if (!isConfigKey(key)) {
            emitError({
              jsonOutput: context.jsonMode,
              action: "config.unset",
              message: `Unknown config key: ${key}`
            });
          }

          const payload = context.state.unsetConfig(key);
          await recordCommand(context, `config unset ${key}`);

          emitSuccess({
            jsonOutput: context.jsonMode,
            action: "config.unset",
            message: "Config removed",
            data: payload
          });
        })
  };
}

export function createConfigDefinition(context: AppContext): CommandDefinition {
  return {
    name: "config",
    path: "config",
    kind: "group",
    summary: "Persist remote defaults for future commands",
    authRequired: false,
    destructive: false,
    confirmationRequired: false,
    children: [
      createConfigShowCommand(context),
      createConfigSetCommand(context),
      createConfigUnsetCommand(context)
    ],
    build: () => new Command("config").description("Persist remote defaults for future commands")
  };
}
