import { describe, expect, test } from "bun:test";
import { MockLanguageModelV3 } from "ai/test";
import { openHarnessAgent } from "./open-harness-agent";
import type { SkillMetadata } from "./skills/types";

const sampleSkill: SkillMetadata = {
  name: "code-review",
  description: "Reviews code changes",
  path: "/tmp/skills/code-review",
  filename: "SKILL.md",
  options: {},
};

function createMockModel() {
  return new MockLanguageModelV3({
    provider: "mock",
    modelId: "mock-model",
    doGenerate: {
      content: [{ type: "text", text: "ok" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: {
          total: 1,
          noCache: 1,
          cacheRead: 0,
          cacheWrite: 0,
        },
        outputTokens: {
          total: 1,
          text: 1,
          reasoning: 0,
        },
      },
      warnings: [],
    },
  });
}

describe("openHarnessAgent system prompt", () => {
  test("injects per-call custom instructions and skills into the model system prompt", async () => {
    const model = createMockModel();

    await openHarnessAgent.generate({
      messages: [{ role: "user", content: "Audit the change." }],
      options: {
        sandboxConfig: {
          kind: "local",
          workingDirectory: "/tmp/workspace",
        },
        approval: {
          type: "interactive",
          autoApprove: "off",
          sessionRules: [],
        },
        customInstructions: "Run tests before committing.",
        skills: [sampleSkill],
        model,
      },
    });

    const firstCall = model.doGenerateCalls[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) {
      throw new Error("Expected one model call");
    }

    const systemMessage = firstCall.prompt.find(
      (message) => message.role === "system",
    );
    expect(systemMessage).toBeDefined();
    if (!systemMessage || systemMessage.role !== "system") {
      throw new Error("Expected a system message in model prompt");
    }

    expect(systemMessage.content).toContain("# Project-Specific Instructions");
    expect(systemMessage.content).toContain("Run tests before committing.");
    expect(systemMessage.content).toContain("## Skills");
    expect(systemMessage.content).toContain(
      "- code-review: Reviews code changes",
    );
  });

  test("uses background mode prompt when approval is background and branch is available", async () => {
    const model = createMockModel();

    await openHarnessAgent.generate({
      messages: [{ role: "user", content: "Continue in background." }],
      options: {
        sandboxConfig: {
          kind: "state",
          state: {
            type: "vercel",
            source: {
              repo: "https://github.com/vercel/ai",
              branch: "main",
              newBranch: "agent/background-test",
            },
          },
        },
        approval: {
          type: "background",
        },
        model,
      },
    });

    const firstCall = model.doGenerateCalls[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) {
      throw new Error("Expected one model call");
    }

    const systemMessage = firstCall.prompt.find(
      (message) => message.role === "system",
    );
    expect(systemMessage).toBeDefined();
    if (!systemMessage || systemMessage.role !== "system") {
      throw new Error("Expected a system message in model prompt");
    }

    expect(systemMessage.content).toContain(
      "# Background Mode - Ephemeral Sandbox",
    );
    expect(systemMessage.content).toContain(
      "Current branch: agent/background-test",
    );
  });

  test("keeps background mode prompt even when branch is unavailable", async () => {
    const model = createMockModel();

    await openHarnessAgent.generate({
      messages: [{ role: "user", content: "Continue in background." }],
      options: {
        sandboxConfig: {
          kind: "state",
          state: {
            type: "vercel",
          },
        },
        approval: {
          type: "background",
        },
        model,
      },
    });

    const firstCall = model.doGenerateCalls[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) {
      throw new Error("Expected one model call");
    }

    const systemMessage = firstCall.prompt.find(
      (message) => message.role === "system",
    );
    expect(systemMessage).toBeDefined();
    if (!systemMessage || systemMessage.role !== "system") {
      throw new Error("Expected a system message in model prompt");
    }

    expect(systemMessage.content).toContain(
      "# Background Mode - Ephemeral Sandbox",
    );
    expect(systemMessage.content).toContain("Current branch: unknown.");
    expect(systemMessage.content).toContain("git branch --show-current");
  });

  test("includes serializable runtime hints from sandboxConfig", async () => {
    const model = createMockModel();

    await openHarnessAgent.generate({
      messages: [{ role: "user", content: "Check environment details." }],
      options: {
        sandboxConfig: {
          kind: "state",
          state: {
            type: "vercel",
          },
          runtimeHints: {
            host: "sbx-3000.vercel.run",
            previewUrlsByPort: {
              "3000": "https://sbx-3000.vercel.run",
            },
          },
        },
        approval: {
          type: "interactive",
          autoApprove: "off",
          sessionRules: [],
        },
        model,
      },
    });

    const firstCall = model.doGenerateCalls[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) {
      throw new Error("Expected one model call");
    }

    const systemMessage = firstCall.prompt.find(
      (message) => message.role === "system",
    );
    expect(systemMessage).toBeDefined();
    if (!systemMessage || systemMessage.role !== "system") {
      throw new Error("Expected a system message in model prompt");
    }

    expect(systemMessage.content).toContain(
      "Sandbox host: sbx-3000.vercel.run",
    );
    expect(systemMessage.content).toContain(
      "Port 3000: https://sbx-3000.vercel.run",
    );
  });
});
