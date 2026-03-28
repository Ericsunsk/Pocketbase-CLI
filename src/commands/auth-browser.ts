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
import { redactAuthResult, saveRemoteAuthResult } from "./auth-support";
import { runPreflightCheck } from "./preflight";
import { LOGIN_BASE_URL_REQUIRED_MESSAGE, requireBaseUrl } from "./support";

const POCKETBASE_LOGO_SVG = `<svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="25.536" y="13.4861" width="1.71467" height="16.7338" transform="rotate(45.9772 25.536 13.4861)" fill="white"/><path d="M26 14H36.8C37.4628 14 38 14.5373 38 15.2V36.8C38 37.4628 37.4628 38 36.8 38H15.2C14.5373 38 14 37.4628 14 36.8V26" fill="white"/><path d="M26 14H36.8C37.4628 14 38 14.5373 38 15.2V36.8C38 37.4628 38 15.2V36.8C38 37.4628 37.4628 38 36.8 38H15.2C14.5373 38 14 37.4628 14 36.8V26" stroke="#16161a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M26 14V3.2C26 2.53726 25.4628 2 24.8 2H3.2C2.53726 2 2 2.53726 2 3.2V24.8C2 25.4628 2.53726 26 3.2 26H14" fill="white"/><path d="M26 14V3.2C26 2.53726 25.4628 2 24.8 2H3.2C2.53726 2 2 2.53726 2 3.2V24.8C2 25.4628 2.53726 26 3.2 26H14" stroke="#16161a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 20C9.44772 20 9 19.5523 9 19V8C9 7.44772 9.44772 7 10 7H13.7531C14.4801 7 15.1591 7.07311 15.7901 7.21932C16.4348 7.35225 16.9904 7.58487 17.4568 7.91718C17.9369 8.2362 18.3141 8.6682 18.5885 9.21319C18.8628 9.74489 19 10.4029 19 11.1871C19 11.9448 18.856 12.6028 18.5679 13.161C18.2936 13.7193 17.9163 14.1779 17.4362 14.5368C16.9561 14.8957 16.4005 15.1616 15.7695 15.3344C15.1385 15.5072 14.4664 15.5936 13.7531 15.5936H13.0247C12.4724 15.5936 12.0247 16.0413 12.0247 16.5936V19C12.0247 19.5523 11.577 20 11.0247 20H10ZM12.0247 12.2607C12.0247 12.813 12.4724 13.2607 13.0247 13.2607H13.5679C15.214 13.2607 16.037 12.5695 16.037 11.1871C16.037 10.5092 15.8244 10.0307 15.3992 9.75153C14.9877 9.47239 14.3772 9.33282 13.5679 9.33282H13.0247C12.4724 9.33282 12.0247 9.78054 12.0247 10.3328V12.2607Z" fill="#16161a"/><path d="M22 33C21.4477 33 21 32.5523 21 32V21C21 20.4477 21.4477 20 22 20H25.4877C26.1844 20 26.8265 20.0532 27.4139 20.1595C28.015 20.2526 28.5342 20.4254 28.9713 20.6779C29.4085 20.9305 29.75 21.2628 29.9959 21.6748C30.2555 22.0869 30.3852 22.6053 30.3852 23.2301C30.3852 23.5225 30.3374 23.8149 30.2418 24.1074C30.1598 24.3998 30.0232 24.6723 29.832 24.9248C29.6407 25.1774 29.4016 25.4034 29.1148 25.6028C28.837 25.7958 28.5081 25.939 28.1279 26.0323C28.1058 26.0378 28.0902 26.0575 28.0902 26.0802V26.0802C28.0902 26.1039 28.1073 26.1242 28.1306 26.1286C29.0669 26.3034 29.7774 26.6332 30.2623 27.1181C30.7541 27.6099 31 28.2945 31 29.1718C31 29.8364 30.8702 30.408 30.6107 30.8865C30.3511 31.365 29.9891 31.7638 29.5246 32.0828C29.0601 32.3885 28.5137 32.6212 27.8852 32.7807C27.2705 32.9269 26.6011 33 25.8771 33H22ZM24.0123 24.2239C24.0123 24.7762 24.46 25.2239 25.0123 25.2239H25.3443C26.082 25.2239 26.6148 25.0844 26.9426 24.8052C27.2705 24.5261 27.4344 24.1339 27.4344 23.6288C27.4344 23.1503 27.2637 22.8113 26.9221 22.612C26.5943 22.3993 26.0751 22.2929 25.3648 22.2929H25.0123C24.46 22.2929 24.0123 22.7407 24.0123 23.2929V24.2239ZM24.0123 29.7071C24.0123 30.2593 24.46 30.7071 25.0123 30.7071H25.6311C27.2432 30.7071 28.0492 30.1222 28.0492 28.9525C28.0492 28.3809 27.8511 27.9688 27.4549 27.7163C27.0724 27.4637 26.4645 27.3374 25.6311 27.3374H25.0123C24.46 27.3374 24.0123 27.7851 24.0123 28.3374V29.7071Z" fill="#16161a"/></svg>`;

interface AuthMethodsPayload {
  password?: {
    identityFields?: string[];
    enabled?: boolean;
  };
  mfa?: {
    enabled?: boolean;
  };
  otp?: {
    enabled?: boolean;
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function titleCaseWords(value: string): string {
  return value
    .split(/\s+/u)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatIdentityLabel(identityFields: string[]): string {
  if (identityFields.length === 0) {
    return "Identity";
  }

  const words = identityFields.map((field) => titleCaseWords(field.replace(/[_-]+/gu, " ")));
  if (words.length === 1) {
    return words[0];
  }

  return `${words.slice(0, -1).join(" or ")} or ${words.at(-1)}`;
}

function getPasswordResetUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/u, "")}/_/#/request-password-reset`;
}

function renderLoginPage(options: {
  baseUrl: string;
  collection: string;
  state: string;
  identity?: string;
  error?: string;
  identityLabel: string;
  identityType: "email" | "text";
  submitLabel: string;
  passwordResetUrl: string;
}): string {
  const identity = options.identity ? escapeHtml(options.identity) : "";
  const error = options.error
    ? `<div class="help-block help-block-error">${escapeHtml(options.error)}</div>`
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
      background: linear-gradient(180deg, #f5f5f7 0%, #eff0f4 100%);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #16161a;
    }
    .page {
      width: min(92vw, 420px);
      margin: 32px auto;
    }
    .brand {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin-bottom: 22px;
      color: #16161a;
      font-size: 28px;
      line-height: 1;
    }
    .brand strong {
      font-weight: 800;
    }
    .brand svg {
      width: 40px;
      height: 40px;
    }
    .panel {
      background: #fff;
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 18px 48px rgba(22, 22, 26, 0.08);
      border: 1px solid rgba(22, 22, 26, 0.06);
    }
    .content {
      text-align: center;
      margin-bottom: 18px;
    }
    .content h4 {
      margin: 0 0 10px;
      font-size: 22px;
      font-weight: 700;
      color: #16161a;
    }
    .meta {
      margin: 0;
      color: #7d7f87;
      font-size: 14px;
      line-height: 1.5;
    }
    .block {
      display: block;
    }
    .form-field {
      margin-bottom: 14px;
    }
    .form-field label {
      display: block;
      margin: 0 0 7px;
      font-size: 14px;
      font-weight: 600;
      color: #2a2d34;
    }
    input {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #d9dce3;
      border-radius: 12px;
      padding: 12px 14px;
      font-size: 15px;
      background: #fff;
      color: #16161a;
      transition: border-color .15s ease, box-shadow .15s ease;
    }
    input:focus {
      outline: none;
      border-color: #16161a;
      box-shadow: 0 0 0 3px rgba(22, 22, 26, 0.08);
    }
    .help-row {
      display: flex;
      justify-content: flex-end;
      margin-top: 8px;
    }
    .link-hint {
      color: #6b7280;
      font-size: 13px;
      text-decoration: none;
    }
    .link-hint:hover {
      color: #16161a;
    }
    .btn {
      width: 100%;
      margin-top: 20px;
      border: 0;
      border-radius: 12px;
      padding: 12px 14px;
      background: #16161a;
      color: #fff;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      transition: transform .12s ease, opacity .12s ease;
    }
    .btn:hover {
      transform: translateY(-1px);
    }
    .help-block-error {
      margin: 0 0 14px;
      padding: 10px 12px;
      border-radius: 10px;
      background: #fff1f2;
      color: #9f1239;
      border: 1px solid #fecdd3;
      font-size: 13px;
      line-height: 1.45;
    }
  </style>
</head>
<body>
  <main class="page">
    <div class="brand">${POCKETBASE_LOGO_SVG}<span>Pocket<strong>Base</strong></span></div>
    <section class="panel">
      <div class="content">
        <h4>Superuser login</h4>
        <p class="meta">Target: ${escapeHtml(options.baseUrl)}<br>Collection: ${escapeHtml(options.collection)}</p>
      </div>
      ${error}
      <form class="block" method="post">
        <input type="hidden" name="state" value="${escapeHtml(options.state)}">
        <div class="form-field required">
          <label for="identity">${escapeHtml(options.identityLabel)}</label>
          <input id="identity" name="identity" type="${options.identityType}" autocomplete="username" value="${identity}" required autofocus>
        </div>
        <div class="form-field required">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required>
          <div class="help-row"><a class="link-hint" href="${escapeHtml(options.passwordResetUrl)}" target="_blank" rel="noreferrer noopener">Forgotten password?</a></div>
        </div>
        <button class="btn btn-next" type="submit"><span class="txt">${escapeHtml(options.submitLabel)}</span><span aria-hidden="true">→</span></button>
      </form>
    </section>
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
          let authMethods: AuthMethodsPayload = {
            password: {
              identityFields: ["email"],
              enabled: true
            },
            mfa: {
              enabled: false
            },
            otp: {
              enabled: false
            }
          };

          try {
            const authMethodsResult = await client.recordAuthMethods(collection);
            authMethods = authMethodsResult.data as AuthMethodsPayload;
          } catch {
            // Keep the fallback password-only form if auth-methods probing fails.
          }

          const identityFields = authMethods.password?.identityFields?.length
            ? authMethods.password.identityFields
            : ["email"];
          const hasExtraSteps = Boolean(authMethods.mfa?.enabled || authMethods.otp?.enabled);
          const identityLabel = formatIdentityLabel(identityFields);
          const identityType =
            identityFields.length === 1 && identityFields[0] === "email" ? "email" : "text";
          const submitLabel = hasExtraSteps ? "Next" : "Login";
          const passwordResetUrl = getPasswordResetUrl(baseUrl);

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
                  identity,
                  identityLabel,
                  identityType,
                  submitLabel,
                  passwordResetUrl
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
                  error: error instanceof Error ? error.message : String(error),
                  identityLabel,
                  identityType,
                  submitLabel,
                  passwordResetUrl
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
                  error: "This browser login session is invalid or expired.",
                  identityLabel,
                  identityType,
                  submitLabel,
                  passwordResetUrl
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
                  error: "Identity and password are required.",
                  identityLabel,
                  identityType,
                  submitLabel,
                  passwordResetUrl
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
                message: "Remote auth login successful and preflight passed",
                data: {
                  auth: redactAuthResult(result),
                  preflight: await runPreflightCheck(context, {
                    requireAuth: true
                  })
                }
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
                  error: message,
                  identityLabel,
                  identityType,
                  submitLabel,
                  passwordResetUrl
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
