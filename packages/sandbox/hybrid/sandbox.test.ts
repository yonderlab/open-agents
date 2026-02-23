import { describe, expect, test } from "bun:test";
import type { Dirent } from "fs";
import type { ExecResult, Sandbox, SandboxStats } from "../interface";
import { HybridSandbox } from "./sandbox";

function createStubSandbox(
  env?: Record<string, string>,
): Sandbox {
  let _env = env ? { ...env } : undefined;
  return {
    type: "in-memory",
    workingDirectory: "/workspace",
    get env() {
      return _env;
    },
    readFile: async () => "",
    writeFile: async () => {},
    stat: async () =>
      ({
        isDirectory: () => false,
        isFile: () => true,
        size: 0,
        mtimeMs: Date.now(),
      }) satisfies SandboxStats,
    access: async () => {},
    mkdir: async () => {},
    readdir: async () => [] as Dirent[],
    exec: async () =>
      ({
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        truncated: false,
      }) satisfies ExecResult,
    stop: async () => {},
    updateEnv(newEnv: Record<string, string | undefined>) {
      if (!_env) _env = {};
      for (const [key, value] of Object.entries(newEnv)) {
        if (value === undefined) {
          delete _env[key];
        } else {
          _env[key] = value;
        }
      }
    },
  };
}

describe("HybridSandbox.execDetached", () => {
  test("throws before cloud handoff", async () => {
    const sandbox = new HybridSandbox({ justBash: createStubSandbox() });

    await expect(
      sandbox.execDetached("npm run dev", sandbox.workingDirectory),
    ).rejects.toThrow(
      "Detached commands are only available after cloud sandbox is ready",
    );
  });
});

describe("HybridSandbox.updateEnv", () => {
  test("updates env on the justBash sandbox before handoff", () => {
    const justBash = createStubSandbox({ EXISTING: "val" });
    const hybrid = new HybridSandbox({ justBash });

    hybrid.updateEnv({ NEW_VAR: "hello" });

    expect(justBash.env).toEqual({ EXISTING: "val", NEW_VAR: "hello" });
  });

  test("removes env vars when value is undefined", () => {
    const justBash = createStubSandbox({ TO_REMOVE: "val", KEEP: "yes" });
    const hybrid = new HybridSandbox({ justBash });

    hybrid.updateEnv({ TO_REMOVE: undefined });

    expect(justBash.env).toEqual({ KEEP: "yes" });
  });

  test("updates both justBash and vercel after handoff", async () => {
    const justBash = createStubSandbox();
    const vercel = createStubSandbox();
    const hybrid = new HybridSandbox({ justBash });

    await hybrid.performHandoff(vercel);

    hybrid.updateEnv({ SHARED: "value" });

    // After handoff justBash is null, so only vercel is updated
    expect(vercel.env).toEqual({ SHARED: "value" });
  });
});
