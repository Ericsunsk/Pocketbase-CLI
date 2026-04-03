import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

describe("tryOpenBrowser", () => {
  afterEach(() => {
    vi.doUnmock("node:child_process");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("returns false when the opener emits an async error", async () => {
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = vi.fn();

    vi.doMock("node:child_process", () => ({
      spawn: () => {
        queueMicrotask(() => {
          child.emit("error", new Error("spawn failed"));
        });

        return child;
      }
    }));

    const { tryOpenBrowser } = await import("../../src/commands/auth-browser");

    await expect(tryOpenBrowser("http://127.0.0.1:8090/login")).resolves.toBe(false);
  });

  it("returns true when the opener starts without an early error", async () => {
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = vi.fn();

    vi.doMock("node:child_process", () => ({
      spawn: () => child
    }));

    const { tryOpenBrowser } = await import("../../src/commands/auth-browser");

    await expect(tryOpenBrowser("http://127.0.0.1:8090/login")).resolves.toBe(true);
    expect(child.unref).toHaveBeenCalledOnce();
  });
});
