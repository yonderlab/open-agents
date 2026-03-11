import { describe, expect, test } from "bun:test";
import { gateway, type ModelMessage } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { openHarnessAgent } from "./open-harness-agent";

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

function getAgentPrepareFunctions() {
  const settings = Reflect.get(openHarnessAgent, "settings");
  if (!settings || typeof settings !== "object") {
    throw new Error("Open Harness agent settings are unavailable");
  }

  const prepareCall = Reflect.get(settings, "prepareCall");
  const prepareStep = Reflect.get(settings, "prepareStep");

  if (typeof prepareCall !== "function" || typeof prepareStep !== "function") {
    throw new Error(
      "Open Harness agent prepareCall/prepareStep are unavailable",
    );
  }

  return { prepareCall, prepareStep };
}

describe("openHarnessAgent prepare hooks", () => {
  test("uses sandbox-provided environment details in prepareStep prompt", async () => {
    const { prepareCall, prepareStep } = getAgentPrepareFunctions();
    const model = createMockModel();

    const preparedCall = await prepareCall({
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
        model,
      },
      model,
      messages: [],
    });

    const preparedStep = await prepareStep({
      model,
      steps: [],
      stepNumber: 0,
      messages: preparedCall.messages ?? [],
      experimental_context: {
        ...preparedCall.experimental_context,
        sandbox: {
          workingDirectory: "/tmp/workspace",
          currentBranch: "agent/host-check",
          environmentDetails: "- Sandbox host: test-sandbox.example.com",
        },
      },
    });

    expect(preparedStep).toBeDefined();
    if (!preparedStep) {
      throw new Error("Expected prepareStep result");
    }

    expect(typeof preparedStep.system).toBe("string");
    if (typeof preparedStep.system !== "string") {
      throw new Error("Expected system prompt from prepareStep");
    }

    expect(preparedStep.system).toContain(
      "Sandbox host: test-sandbox.example.com",
    );
  });

  test("falls back to serialized runtime context when prepareStep has no live sandbox", async () => {
    const { prepareCall, prepareStep } = getAgentPrepareFunctions();
    const model = createMockModel();

    const preparedCall = await prepareCall({
      options: {
        sandboxConfig: {
          kind: "state",
          state: {
            type: "vercel",
            source: {
              repo: "https://github.com/vercel/ai",
              branch: "main",
              newBranch: "agent/fallback-context",
            },
          },
          runtimeHints: {
            host: "sbx-fallback.vercel.run",
          },
        },
        approval: {
          type: "background",
        },
        model,
      },
      model,
      messages: [],
    });

    const preparedStep = await prepareStep({
      model,
      steps: [],
      stepNumber: 0,
      messages: preparedCall.messages ?? [],
      experimental_context: preparedCall.experimental_context,
    });

    expect(preparedStep).toBeDefined();
    if (!preparedStep) {
      throw new Error("Expected prepareStep result");
    }

    expect(typeof preparedStep.system).toBe("string");
    if (typeof preparedStep.system !== "string") {
      throw new Error("Expected system prompt from prepareStep");
    }

    expect(preparedStep.system).toContain(
      "Sandbox host: sbx-fallback.vercel.run",
    );
    expect(preparedStep.system).toContain(
      "Current branch: agent/fallback-context",
    );
  });

  test("prefers live sandbox metadata over serialized runtime context", async () => {
    const { prepareCall, prepareStep } = getAgentPrepareFunctions();
    const model = createMockModel();

    const preparedCall = await prepareCall({
      options: {
        sandboxConfig: {
          kind: "state",
          state: {
            type: "vercel",
            source: {
              repo: "https://github.com/vercel/ai",
              branch: "main",
              newBranch: "agent/from-config",
            },
          },
          runtimeHints: {
            host: "config-host.example.com",
          },
        },
        approval: {
          type: "background",
        },
        model,
      },
      model,
      messages: [],
    });

    const preparedStep = await prepareStep({
      model,
      steps: [],
      stepNumber: 0,
      messages: preparedCall.messages ?? [],
      experimental_context: {
        ...preparedCall.experimental_context,
        sandbox: {
          workingDirectory: "/vercel/sandbox",
          currentBranch: "agent/from-live",
          environmentDetails: "- Sandbox host: live-host.example.com",
        },
      },
    });

    expect(preparedStep).toBeDefined();
    if (!preparedStep) {
      throw new Error("Expected prepareStep result");
    }

    expect(typeof preparedStep.system).toBe("string");
    if (typeof preparedStep.system !== "string") {
      throw new Error("Expected system prompt from prepareStep");
    }

    expect(preparedStep.system).toContain("Current branch: agent/from-live");
    expect(preparedStep.system).toContain(
      "Sandbox host: live-host.example.com",
    );
    expect(preparedStep.system).not.toContain("agent/from-config");
    expect(preparedStep.system).not.toContain("config-host.example.com");
  });

  test("throws when prepareStep is called without runtime context", async () => {
    const { prepareStep } = getAgentPrepareFunctions();
    const model = createMockModel();

    await expect(
      Promise.resolve().then(() =>
        prepareStep({
          model,
          steps: [],
          stepNumber: 0,
          messages: [],
          experimental_context: undefined,
        }),
      ),
    ).rejects.toThrow("Open Harness agent missing runtime context");
  });

  test("sanitizes GPT-5.4 prompts through prepareCall", async () => {
    const { prepareCall } = getAgentPrepareFunctions();
    const model = gateway("openai/gpt-5.4-codex");

    const prompt = [
      { role: "user", content: "Plan the fix." },
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "Inspecting the failure",
            providerOptions: {
              openai: {
                itemId: "rs_123",
              },
            },
          },
        ],
      },
    ] satisfies ModelMessage[];

    const preparedCall = await prepareCall({
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
        model,
      },
      model,
      prompt,
    });

    expect(preparedCall.prompt).toEqual([
      {
        role: "user",
        content: "Plan the fix.",
      },
    ]);
  });
});
