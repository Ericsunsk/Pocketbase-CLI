import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, IncomingMessage, ServerResponse } from "node:http";

import { Command } from "commander";

import {
  AppContext,
  recordCommand,
  resolveAuthCollection
} from "../app/context";
import type { CommandDefinition } from "../contract/command-registry";
import { createOptionParameter } from "../contract/metadata";
import { emitError, emitSuccess } from "../core/output";
import { PocketBaseRemoteClient, PocketBaseRemoteError } from "../http/remote-client";
import { parseIntegerOptionValue } from "../input/validators";
import { saveRemoteAuthResult } from "./auth-support";
import { LOGIN_BASE_URL_REQUIRED_MESSAGE, requireBaseUrl } from "./support";

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function renderLoginPage(options: {
  baseUrl: string;
  collection: string;
  state: string;
  identity?: string;
  error?: string;
}): string {
  const identity = options.identity ? escapeHtml(options.identity) : "";
  const error = options.error
    ? `<p style="margin:0 0 16px;padding:12px 14px;border-radius:10px;background:#fff1f2;color:#9f1239;border:1px solid #fecdd3;">${escapeHtml(options.error)}</p>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PocketBase CLI Login</title>
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background:
        radial-gradient(circle at top left, #dbeafe 0%, transparent 32%),
        radial-gradient(circle at bottom right, #fce7f3 0%, transparent 28%),
        linear-gradient(135deg, #f8fafc 0%, #eef2ff 100%);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #0f172a;
    }
    .card {
      width: min(92vw, 420px);
      padding: 28px;
      border-radius: 20px;
      background: rgba(255, 255, 255, 0.92);
      box-shadow: 0 20px 60px rgba(15, 23, 42, 0.14);
      border: 1px solid rgba(148, 163, 184, 0.2);
      backdrop-filter: blur(16px);
    }
    h1 {
      margin: 0 0 8px;
      font-size: 24px;
    }
    p.meta {
      margin: 0 0 18px;
      color: #475569;
      line-height: 1.5;
      font-size: 14px;
    }
    code {
      padding: 2px 6px;
      border-radius: 999px;
      background: #e2e8f0;
      font-size: 12px;
    }
    label {
      display: block;
      margin: 14px 0 6px;
      font-size: 14px;
      font-weight: 600;
    }
    input {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #cbd5e1;
      border-radius: 12px;
      padding: 12px 14px;
      font-size: 15px;
      background: #fff;
    }
    input:focus {
      outline: 2px solid #93c5fd;
      border-color: #3b82f6;
    }
    button {
      width: 100%;
      margin-top: 20px;
      border: 0;
      border-radius: 12px;
      padding: 12px 14px;
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      color: #fff;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <main class="card">
    <h1>Sign in to PocketBase CLI</h1>
    <p class="meta">Target: <code>${escapeHtml(options.baseUrl)}</code><br>Collection: <code>${escapeHtml(options.collection)}</code></p>
    ${error}
    <form method="post">
      <input type="hidden" name="state" value="${escapeHtml(options.state)}">
      <label for="identity">Identity</label>
      <input id="identity" name="identity" type="text" autocomplete="username" value="${identity}" required>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Sign In</button>
    </form>
  </main>
</body>
</html>`;
}

function renderSuccessPage(baseUrl: string, collection: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Login complete</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: linear-gradient(135deg, #ecfdf5 0%, #dbeafe 100%);
      color: #0f172a;
    }
    .card {
      width: min(92vw, 420px);
      padding: 28px;
      border-radius: 20px;
      background: rgba(255,255,255,0.95);
      box-shadow: 0 20px 60px rgba(15, 23, 42, 0.12);
      text-align: center;
    }
    code {
      padding: 2px 6px;
      border-radius: 999px;
      background: #dcfce7;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <main class="card">
    <h1>Login complete</h1>
    <p>The CLI has saved your auth token for <code>${escapeHtml(baseUrl)}</code> and collection <code>${escapeHtml(collection)}</code>.</p>
    <p>You can close this tab.</p>
  </main>
</body>
</html>`;
}

function writeHtml(response: ServerResponse, status: number, body: string): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(body);
}

async function readFormBody(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 64 * 1024) {
      throw new Error("Browser login form payload exceeded 64 KB.");
    }
    chunks.push(buffer);
  }

  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function tryOpenBrowser(url: string): boolean {
  const command =
    process.platform === "darwin"
      ? { bin: "open", args: [url] }
      : process.platform === "win32"
        ? { bin: "cmd", args: ["/c", "start", "", url] }
        : { bin: "xdg-open", args: [url] };

  try {
    const child = spawn(command.bin, command.args, {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function parseTimeoutSeconds(
  context: AppContext,
  action: string,
  value: string | undefined
): number {
  if (value === undefined) {
    return 300;
  }

  try {
    const parsed = parseIntegerOptionValue("--timeout", value);
    if (parsed <= 0) {
      throw new Error("--timeout expects a positive integer value");
    }
    return parsed;
  } catch (error) {
    emitError({
      jsonOutput: context.jsonMode,
      action,
      message: error instanceof Error ? error.message : String(error),
      errorType: "invalid_input"
    });
  }
}

function writeLaunchMessage(options: {
  url: string;
  autoOpened: boolean;
  timeoutSeconds: number;
}): void {
  const prefix = options.autoOpened
    ? "Opened browser for login. If nothing appeared, use this URL:"
    : "Open this URL in your browser to continue login:";
  process.stderr.write(`${prefix}\n${options.url}\n`);
  process.stderr.write(`Waiting up to ${options.timeoutSeconds}s for browser login to complete.\n`);
}

export function createAuthLoginBrowserDefinition(context: AppContext): CommandDefinition {
  return {
    name: "login-browser",
    path: "auth.login-browser",
    kind: "command",
    summary: "Open a local browser login page and save the resulting remote auth token",
    authRequired: false,
    destructive: false,
    confirmationRequired: false,
    examples: ["pocketbase-cli auth login-browser", "pocketbase-cli auth login-browser --no-open"],
    notes: [
      "This command starts a temporary HTTP server bound to 127.0.0.1 and never exposes credentials over a remote callback URL."
    ],
    parameters: [
      createOptionParameter({
        name: "--base-url",
        type: "TEXT",
        help: "PocketBase base URL, for example `https://pb.example.com`"
      }),
      createOptionParameter({
        name: "--collection",
        type: "TEXT",
        help: "Auth collection name, defaults to `config auth_collection` or `_superusers`"
      }),
      createOptionParameter({
        name: "--identity",
        type: "TEXT",
        help: "Prefill the browser form identity field"
      }),
      createOptionParameter({
        name: "--timeout",
        type: "INTEGER",
        help: "How many seconds to wait for the browser login to complete",
        default: 300
      }),
      createOptionParameter({
        name: "--no-open",
        type: "BOOLEAN",
        help: "Start the local login page but do not try to auto-open a browser",
        isFlag: true
      })
    ],
    build: () =>
      new Command("login-browser")
        .description("Open a local browser login page and save the resulting remote auth token")
        .option("--base-url <url>", "PocketBase base URL, for example https://pb.example.com")
        .option(
          "--collection <name>",
          "Auth collection to use, defaults to config auth_collection or _superusers"
        )
        .option("--identity <value>", "Prefill the browser form identity field")
        .option("--timeout <seconds>", "How many seconds to wait for browser login", "300")
        .option("--no-open", "Do not auto-open the browser")
        .action(async (options: {
          baseUrl?: string;
          collection?: string;
          identity?: string;
          timeout?: string;
          open?: boolean;
        }) => {
          const action = "auth.login-browser";
          const baseUrl = requireBaseUrl(context, {
            action,
            baseUrl: options.baseUrl,
            message: LOGIN_BASE_URL_REQUIRED_MESSAGE
          });
          const collection = options.collection ?? resolveAuthCollection(context);
          const identity = options.identity?.trim() || context.envConfig?.auth_identity?.trim() || "";
          const timeoutSeconds = parseTimeoutSeconds(context, action, options.timeout);
          const timeoutMs = timeoutSeconds * 1000;
          const sessionState = randomBytes(24).toString("hex");
          const routePath = `/login/${randomBytes(12).toString("hex")}`;
          const client = new PocketBaseRemoteClient({
            baseUrl,
            collection,
            timeout: context.state.config.timeout ?? null
          });

          const historyParts = ["auth", "login-browser"];
          if (options.baseUrl) {
            historyParts.push("--base-url", options.baseUrl);
          }
          if (options.collection) {
            historyParts.push("--collection", options.collection);
          }
          if (options.identity) {
            historyParts.push("--identity", options.identity);
          }
          if (options.open === false) {
            historyParts.push("--no-open");
          }
          if (options.timeout && options.timeout !== "300") {
            historyParts.push("--timeout", options.timeout);
          }
          await recordCommand(context, historyParts.join(" "));

          let settled = false;
          let launchUrl = "";
          let timeoutHandle: NodeJS.Timeout | null = null;

          const server = createServer(async (request, response) => {
            if (settled) {
              writeHtml(response, 410, "<p>This browser login session is already complete.</p>");
              return;
            }

            const requestPath = request.url ? new URL(request.url, "http://127.0.0.1").pathname : "/";
            if (requestPath !== routePath) {
              writeHtml(response, 404, "<p>Not found.</p>");
              return;
            }

            if (request.method === "GET") {
              writeHtml(
                response,
                200,
                renderLoginPage({
                  baseUrl,
                  collection,
                  state: sessionState,
                  identity
                })
              );
              return;
            }

            if (request.method !== "POST") {
              response.statusCode = 405;
              response.setHeader("Allow", "GET, POST");
              response.end("Method Not Allowed");
              return;
            }

            let form: URLSearchParams;
            try {
              form = await readFormBody(request);
            } catch (error) {
              writeHtml(
                response,
                413,
                renderLoginPage({
                  baseUrl,
                  collection,
                  state: sessionState,
                  identity,
                  error: error instanceof Error ? error.message : String(error)
                })
              );
              return;
            }

            const postedState = form.get("state") ?? "";
            const postedIdentity = form.get("identity")?.trim() ?? "";
            const postedPassword = form.get("password") ?? "";

            if (postedState !== sessionState) {
              writeHtml(
                response,
                400,
                renderLoginPage({
                  baseUrl,
                  collection,
                  state: sessionState,
                  identity: postedIdentity || identity,
                  error: "This browser login session is invalid or expired."
                })
              );
              return;
            }

            if (!postedIdentity || !postedPassword) {
              writeHtml(
                response,
                400,
                renderLoginPage({
                  baseUrl,
                  collection,
                  state: sessionState,
                  identity: postedIdentity || identity,
                  error: "Identity and password are required."
                })
              );
              return;
            }

            try {
              const result = await client.login({
                identity: postedIdentity,
                password: postedPassword
              });

              await saveRemoteAuthResult(context, {
                result,
                action: "auth login-browser",
                baseUrl,
                collection
              });

              settled = true;
              writeHtml(response, 200, renderSuccessPage(baseUrl, collection));
              if (timeoutHandle) {
                clearTimeout(timeoutHandle);
              }
              server.close();

              emitSuccess({
                jsonOutput: context.jsonMode,
                action,
                message: "Remote auth login successful",
                data: result
              });
            } catch (error) {
              const message =
                error instanceof PocketBaseRemoteError
                  ? error.message
                  : error instanceof Error
                    ? error.message
                    : String(error);
              writeHtml(
                response,
                error instanceof PocketBaseRemoteError ? error.status : 500,
                renderLoginPage({
                  baseUrl,
                  collection,
                  state: sessionState,
                  identity: postedIdentity,
                  error: message
                })
              );
            }
          });

          await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", () => {
              server.off("error", reject);
              resolve();
            });
          });

          const address = server.address();
          if (!address || typeof address === "string") {
            server.close();
            emitError({
              jsonOutput: context.jsonMode,
              action,
              message: "Failed to determine the local browser login server address."
            });
          }

          launchUrl = `http://127.0.0.1:${address.port}${routePath}`;
          const autoOpened = options.open !== false ? tryOpenBrowser(launchUrl) : false;
          writeLaunchMessage({
            url: launchUrl,
            autoOpened,
            timeoutSeconds
          });

          await new Promise<void>((resolve, reject) => {
            timeoutHandle = setTimeout(() => {
              if (!settled) {
                settled = true;
                server.close();
                reject(
                  new Error(
                    `Browser login timed out after ${timeoutSeconds} seconds. Re-run the command to start a new session.`
                  )
                );
              }
            }, timeoutMs);

            server.on("close", () => {
              if (settled) {
                resolve();
              }
            });
          }).catch((error) => {
            emitError({
              jsonOutput: context.jsonMode,
              action,
              message: error instanceof Error ? error.message : String(error)
            });
          });
        })
  };
}
