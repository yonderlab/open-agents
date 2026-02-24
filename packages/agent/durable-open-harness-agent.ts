import type {
  Sandbox,
  SandboxState,
  ConnectOptions,
} from "@open-harness/sandbox";
import {
  gateway,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from "ai";
import {
  DurableAgent,
  type CompatibleLanguageModel,
  type DurableAgentOptions,
  type DurableAgentStreamOptions,
  type PrepareStepCallback,
} from "@workflow/ai/agent";
import { z } from "zod";
import { addCacheControl, compactContext } from "./context-management";
import type { SkillMetadata } from "./skills/types";
import { buildSystemPrompt } from "./system-prompt";
import {
  askUserQuestionTool,
  bashTool,
  editFileTool,
  globTool,
  grepTool,
  readFileTool,
  skillTool,
  taskTool,
  todoWriteTool,
  webFetchTool,
  writeFileTool,
} from "./tools";
import type { ApprovalConfig } from "./types";
import { approvalRuleSchema } from "./types";

// ---------------------------------------------------------------------------
// Schemas – identical to the non-durable agent
// ---------------------------------------------------------------------------

const approvalConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("interactive"),
    autoApprove: z.enum(["off", "edits", "all"]).default("off"),
    sessionRules: z.array(approvalRuleSchema).default([]),
  }),
  z.object({ type: z.literal("background") }),
  z.object({ type: z.literal("delegated") }),
]);

export const durableCallOptionsSchema = z.object({
  sandbox: z.custom<Sandbox>(),
  approval: approvalConfigSchema,
  model: z.custom<LanguageModel>().optional(),
  subagentModel: z.custom<LanguageModel>().optional(),
  customInstructions: z.string().optional(),
  skills: z.custom<SkillMetadata[]>().optional(),
});

export type DurableOpenHarnessAgentCallOptions = z.infer<
  typeof durableCallOptionsSchema
>;

// ---------------------------------------------------------------------------
// Serializable call options – for use as workflow arguments
// ---------------------------------------------------------------------------

/**
 * JSON-serializable version of {@link DurableOpenHarnessAgentCallOptions}.
 *
 * Workflow arguments must be serializable. This replaces the live `Sandbox`
 * and `LanguageModel` instances with their serializable representations
 * (sandbox state + connect options, model ID strings).
 *
 * Use {@link reconstituteDurableCallOptions} inside a `"use step"` function
 * to reconstruct the full call options from serializable data.
 */
export interface SerializableDurableCallOptions {
  sandboxState: SandboxState;
  sandboxConnectOptions?: ConnectOptions;
  approval: DurableOpenHarnessAgentCallOptions["approval"];
  modelId?: string;
  subagentModelId?: string;
  customInstructions?: string;
  skills?: SkillMetadata[];
}

/**
 * Reconstruct full {@link DurableOpenHarnessAgentCallOptions} from serializable
 * workflow arguments. Call this inside a `"use step"` function where Node.js
 * modules are available.
 */
export async function reconstituteDurableCallOptions(
  options: SerializableDurableCallOptions,
): Promise<DurableOpenHarnessAgentCallOptions> {
  const { connectSandbox } = await import("@open-harness/sandbox");

  const sandbox = await connectSandbox(
    options.sandboxState,
    options.sandboxConnectOptions,
  );

  const model = options.modelId
    ? gateway(options.modelId as Parameters<typeof gateway>[0])
    : undefined;
  const subagentModel = options.subagentModelId
    ? gateway(options.subagentModelId as Parameters<typeof gateway>[0])
    : undefined;

  return {
    sandbox,
    approval: options.approval,
    model,
    subagentModel,
    customInstructions: options.customInstructions,
    skills: options.skills,
  };
}

// ---------------------------------------------------------------------------
// Default model – same as non-durable agent
// ---------------------------------------------------------------------------

export const durableDefaultModel = gateway("anthropic/claude-haiku-4.5");
export const durableDefaultModelLabel = durableDefaultModel.modelId;

// ---------------------------------------------------------------------------
// Tool set – identical to the non-durable agent
// ---------------------------------------------------------------------------

const tools = {
  todo_write: todoWriteTool,
  read: readFileTool(),
  write: writeFileTool(),
  edit: editFileTool(),
  grep: grepTool(),
  glob: globTool(),
  bash: bashTool(),
  task: taskTool,
  ask_user_question: askUserQuestionTool,
  skill: skillTool,
  web_fetch: webFetchTool,
} satisfies ToolSet;

// ---------------------------------------------------------------------------
// Durable agent instance (default configuration)
// ---------------------------------------------------------------------------

/**
 * A durable version of `openHarnessAgent` powered by Workflow DevKit.
 *
 * Uses the same default model, tools, and system prompt as the non-durable
 * agent. Intended for use inside a `"use workflow"` function.
 *
 * For runtime-resolved configuration (custom model, sandbox-aware system
 * prompt, cache-controlled tools, context management), use
 * {@link prepareDurableCall} which returns both constructor and stream
 * options so you can create a fully configured agent:
 *
 * @example
 * ```ts
 * const { agentOptions, streamOptions } = prepareDurableCall(callOptions);
 * const agent = new DurableAgent(agentOptions);
 * const result = await agent.stream({ messages, writable, ...streamOptions });
 * ```
 */
export const durableOpenHarnessAgent = new DurableAgent({
  model: () => Promise.resolve(durableDefaultModel as CompatibleLanguageModel),
  system: buildSystemPrompt({}),
  tools,
});

export type DurableOpenHarnessAgent = typeof durableOpenHarnessAgent;

// ---------------------------------------------------------------------------
// prepareDurableCall – mirrors ToolLoopAgent's prepareCall + prepareStep
// ---------------------------------------------------------------------------

/**
 * Resolves runtime call options into everything needed to construct a
 * `DurableAgent` and call `.stream()` on it.
 *
 * This is the durable equivalent of the non-durable agent's `prepareCall`
 * and `prepareStep` combined. It resolves the model, builds the
 * sandbox-aware system prompt, applies cache-control to tools, and wires up
 * context management (compactContext + addCacheControl on messages).
 *
 * Returns two objects:
 * - `agentOptions` – pass to `new DurableAgent(agentOptions)`
 * - `streamOptions` – spread into `agent.stream({ messages, writable, ...streamOptions })`
 *
 * @example
 * ```ts
 * async function myWorkflow(messages, callOptions) {
 *   "use workflow";
 *   const { agentOptions, streamOptions } = prepareDurableCall(callOptions);
 *   const agent = new DurableAgent(agentOptions);
 *   const result = await agent.stream({
 *     messages,
 *     writable: getWritable<UIMessageChunk>(),
 *     ...streamOptions,
 *   });
 *   return result;
 * }
 * ```
 */
export function prepareDurableCall(
  options: DurableOpenHarnessAgentCallOptions,
) {
  const approval: ApprovalConfig = options.approval;
  const callModel = options.model ?? durableDefaultModel;
  const subagentModel = options.subagentModel;
  const customInstructions = options.customInstructions;
  const sandbox = options.sandbox;
  const skills = options.skills ?? [];

  // Derive mode for system prompt (interactive vs background)
  const mode = approval.type === "background" ? "background" : "interactive";

  const system = buildSystemPrompt({
    cwd: sandbox.workingDirectory,
    mode,
    currentBranch: sandbox.currentBranch,
    customInstructions,
    environmentDetails: sandbox.environmentDetails,
    skills,
    modelId: typeof callModel === "string" ? callModel : callModel.modelId,
  });

  // DurableAgent model: string gateway ID or factory function
  const model =
    typeof callModel === "string"
      ? callModel
      : () => Promise.resolve(callModel as CompatibleLanguageModel);

  // Apply cache-control to tool definitions (same as non-durable agent)
  const durableTools = addCacheControl({
    tools,
    model: callModel,
  });

  // prepareStep – mirrors the non-durable agent's prepareStep.
  // Runs before each LLM step: compacts context and adds cache-control,
  // and overrides the model to the runtime-resolved one.
  const prepareStep: PrepareStepCallback<typeof tools> = ({
    messages: stepMessages,
    steps,
  }) => ({
    // Override the model per-step so the runtime-resolved model takes effect.
    model,
    // DurableAgent uses LanguageModelV2Prompt internally while
    // compactContext / addCacheControl work with ModelMessage[] (V3).
    // The runtime shapes are compatible so we cast at the boundary.
    messages: addCacheControl({
      messages: compactContext({
        messages: stepMessages as unknown as ModelMessage[],
        steps,
      }),
      model: callModel,
    }) as typeof stepMessages,
  });

  // -- Constructor options for `new DurableAgent(...)` ---------------------
  const agentOptions = {
    model,
    system,
    tools: durableTools,
  } satisfies DurableAgentOptions & { tools: typeof tools };

  // -- Stream options for `agent.stream({ messages, writable, ... })` ------
  const streamOptions = {
    system,
    maxSteps: 100, // mirrors stopWhen: stepCountIs(100)
    experimental_context: {
      sandbox,
      approval,
      skills,
      model: callModel,
      subagentModel,
    },
    prepareStep,
  } satisfies Partial<DurableAgentStreamOptions<typeof tools>>;

  return { agentOptions, streamOptions };
}
