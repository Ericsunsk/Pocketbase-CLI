import { vi } from "vitest";

function captureStream(streamName: "stdout" | "stderr"): {
  output: string[];
  restore: () => void;
} {
  const output: string[] = [];
  const stream = process[streamName];
  const writeSpy = vi.spyOn(stream, "write").mockImplementation((chunk: string | Uint8Array) => {
    output.push(String(chunk));
    return true;
  });

  return {
    output,
    restore: () => {
      writeSpy.mockRestore();
    }
  };
}

export function captureStdout(): { output: string[]; restore: () => void } {
  return captureStream("stdout");
}

export function captureStderr(): { output: string[]; restore: () => void } {
  return captureStream("stderr");
}

export function silenceProcessOutput(): { restore: () => void } {
  const stdout = captureStdout();
  const stderr = captureStderr();

  return {
    restore: () => {
      stdout.restore();
      stderr.restore();
    }
  };
}
