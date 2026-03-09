# Durable Agent Web-First Migration Plan

## Summary

Migrate the web chat path to a durable workflow-backed agent without replacing the existing `ToolLoopAgent` implementation used by the CLI and local flows.

The main architectural change is that anything crossing workflow and step boundaries must be serializable. In this codebase that means tools cannot rely on a live `Sandbox` instance in `experimental_context`; durable tool execution needs to reconnect to the sandbox inside each step using serializable sandbox state.

## Recommendation

Do this as a **web-first sibling implementation**, not as a full replacement of `packages/agent/open-harness-agent.ts`.

Keep the current agent for:

- `apps/cli`
- local / non-workflow execution paths
- any runtime that still expects `ToolLoopAgent`-specific streaming helpers

Add a new durable path for:

- `apps/web` chat execution
- workflow-backed streaming and resume
- workflow-backed cancellation

This keeps the migration scoped and avoids breaking the CLI while still getting the benefits of durable execution on the web.

## Key Findings

### 1. The current web chat route is tightly coupled to a live sandbox

Current entrypoint:

- `apps/web/app/api/chat/route.ts`

That route currently does all of the following inline before calling the agent:

- authenticates the request
- verifies session/chat ownership
- connects a live sandbox with `connectSandbox(sessionRecord.sandboxState, ...)`
- refreshes git remote auth
- discovers skills from the sandbox filesystem
- resolves model and subagent model
- calls `webAgent.stream(...)`
- persists assistant output and sandbox state in `onFinish`

This must be split so that only serializable data is passed into the workflow.

### 2. Existing tools assume a live `Sandbox` object in context

Current tool context helper:

- `packages/agent/tools/utils.ts`

Today, tools call `getSandbox(experimental_context, ...)` and use a live sandbox directly. That works with `ToolLoopAgent`, but it is not durable-safe because the sandbox object is not serializable.

For durable execution, the context needs to carry serializable data instead:

- `sandboxState`
- optional connect options such as env vars / ports
- `workingDirectory`
- `currentBranch`
- `environmentDetails`
- approval config
- skill metadata
- serializable model config

Then each durable tool execution reconnects inside a step.

In this repo, the equivalent of the user's `connectToSandbox` idea is:

- `connectSandbox(...)` from `@open-harness/sandbox`

not `Sandbox.get(...)` from `@vercel/sandbox`.

### 3. Workflow infrastructure already exists on the web side

Relevant files:

- `apps/web/next.config.ts`
- `apps/web/app/workflows/sandbox-lifecycle.ts`
- `apps/web/lib/sandbox/lifecycle-kick.ts`

So the web app is already set up to run workflows. This makes the web path the natural place to introduce a durable agent.

### 4. The CLI is still built around the current singleton agent

Relevant files:

- `apps/cli/tui/config.ts`
- `apps/cli/tui/transport.ts`
- `apps/cli/tui/types.ts`

The CLI derives types and behavior from `openHarnessAgent` and depends on `ToolLoopAgent` result helpers such as:

- stream-to-UI helpers
- usage accessors
- message/type inference from the singleton agent

Replacing the agent globally would create a much larger migration than necessary.

### 5. The current web streaming model is not workflow-based yet

Current web resume/cancel infrastructure:

- `apps/web/lib/resumable-stream-context.ts`
- `apps/web/app/api/chat/[chatId]/stream/route.ts`
- `apps/web/app/api/chat/[chatId]/stop/route.ts`
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-context.tsx`
- `apps/web/lib/abortable-chat-transport.ts`

Today:

- streaming resume uses Redis-backed resumable streams
- stop uses Redis pub/sub
- the client uses `AbortableChatTransport`

A durable migration should replace this with workflow-native behavior:

- start workflow and persist run ID
- resume with `getRun(runId).getReadable({ startIndex })`
- cancel with `getRun(runId).cancel()`
- use `WorkflowChatTransport` on the client

### 6. Not every tool is equally easy to port

Straightforward reconnect-per-step tools:

- `packages/agent/tools/read.ts`
- `packages/agent/tools/write.ts`
- `packages/agent/tools/bash.ts`
- `packages/agent/tools/glob.ts`
- `packages/agent/tools/grep.ts`
- `packages/agent/tools/skill.ts`

Easy because they mostly:

- validate input
- do one sandbox operation
- return serializable output

Special cases:

- `packages/agent/tools/task.ts`
- `packages/agent/tools/ask-user-question.ts`

`task` is the biggest migration wrinkle because it currently uses:

- async generator output
- nested `ToolLoopAgent` subagents
- progressive status updates
- final message extraction from a subagent response

`ask-user-question` is client-side only, so it does not need sandbox reconnection, but it still needs to remain compatible with the durable UI streaming flow.

### 7. Sandbox reconnecting is safe only for reconnectable states

Relevant sandbox types:

- `packages/sandbox/factory.ts`
- `packages/sandbox/vercel/state.ts`
- `packages/sandbox/hybrid/state.ts`
- `packages/sandbox/just-bash/state.ts`

Important constraint:

- reconnect-per-tool works naturally for `vercel` sandboxes and `hybrid` sandboxes with a `sandboxId`
- it is not naturally stable for `just-bash` and pre-handoff `hybrid` states unless updated sandbox state is threaded forward across steps

That means a durable v1 should likely be limited to sandboxId-backed sessions, with fallback to the current path for pre-handoff/local states.

### 8. Dependency alignment is required

Current dependency state:

- `apps/web/package.json` uses `workflow@^4.1.0-beta.52`
- `packages/agent/package.json` does not include `@workflow/ai`

Observed package constraints:

- `@workflow/ai` requires a compatible `workflow` version

So part of the migration is dependency alignment before implementation begins.

## Proposed Architecture

## Durable web path

1. API route validates auth and ownership
2. API route resolves model selection, skills, GitHub token, and sandbox connect options
3. API route starts a workflow with only serializable input
4. Workflow streams `UIMessageChunk`s
5. Durable tools reconnect to sandbox inside their step execute helpers
6. Workflow persists final assistant message, usage, and sandbox state
7. Client reconnects using workflow run ID

## Keep current non-durable path intact

The existing `openHarnessAgent` stays in place for:

- CLI
- existing local transports
- any unsupported sandbox state fallback

## Required Context Refactor

The current live runtime context contains a non-serializable sandbox instance. A durable context should instead contain serializable fields such as:

```ts
interface DurableAgentContext {
  sandboxState: SandboxState;
  sandboxConnectOptions?: {
    env?: Record<string, string>;
    ports?: number[];
  };
  workingDirectory: string;
  currentBranch?: string;
  environmentDetails?: string;
  approval: ApprovalConfig;
  skills?: SkillMetadata[];
  modelConfig?: {
    modelId: string;
    providerOptionsOverrides?: ProviderOptionsByProvider;
  };
  subagentModelConfig?: {
    modelId: string;
    providerOptionsOverrides?: ProviderOptionsByProvider;
  };
  context?: {
    contextLimit?: number;
    lastInputTokens?: number;
  };
}
```

Then durable tool execution becomes conceptually:

```ts
async function readFileStep(args: ReadArgs, context: DurableAgentContext) {
  "use step";

  const sandbox = await connectSandbox(context.sandboxState, context.sandboxConnectOptions);
  // perform tool work
}
```

## File-Level Changes

### New files

- `packages/agent/durable-agent.ts`
  - durable agent wrapper for web execution
  - reuses system prompt, context compaction, cache-control, usage helpers, and tool definitions

- `apps/web/app/workflows/chat.ts`
  - main durable workflow entrypoint
  - owns workflow streaming and finish-time persistence

### Modified files in `packages/agent`

- `packages/agent/package.json`
  - add `@workflow/ai`
  - align workflow dependency usage

- `packages/agent/index.ts`
  - export durable runtime and types

- `packages/agent/types.ts`
  - add serializable durable context / model config types
  - avoid relying on live `Sandbox` in durable execution

- `packages/agent/tools/utils.ts`
  - add helpers for durable context access
  - add reconnect helper using `connectSandbox`
  - keep compatibility with current live-sandbox path

- `packages/agent/tools/read.ts`
- `packages/agent/tools/write.ts`
- `packages/agent/tools/bash.ts`
- `packages/agent/tools/glob.ts`
- `packages/agent/tools/grep.ts`
- `packages/agent/tools/skill.ts`
  - move actual sandbox work into top-level step helpers
  - reconnect sandbox inside the durable execute path

- `packages/agent/tools/task.ts`
  - either:
    - add a first-pass durable-safe version with reduced progressive output behavior, or
    - explicitly keep this tool on the legacy path until subagent streaming is redesigned

- `packages/agent/tools/tools.test.ts`
  - add tests for reconnect-based execution and serializable context

### Modified files in `apps/web`

- `apps/web/package.json`
  - upgrade `workflow` to a version compatible with `@workflow/ai`

- `apps/web/app/api/chat/route.ts`
  - stop calling `webAgent.stream(...)` directly
  - start the workflow instead
  - set `chats.activeStreamId` to workflow run ID
  - return the workflow stream plus `x-workflow-run-id`

- `apps/web/app/api/chat/[chatId]/stream/route.ts`
  - replace Redis resumable stream lookup with workflow run readable stream lookup

- `apps/web/app/api/chat/[chatId]/stop/route.ts`
  - replace Redis stop pub/sub with workflow cancellation

- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-context.tsx`
  - replace `AbortableChatTransport` with `WorkflowChatTransport`
  - keep reconnect behavior keyed by chat ID / active run ID

- `apps/web/app/config.ts`
  - likely stop treating `webAgent` as the direct streaming runtime for web chat

### Files that may become unused or reduced

- `apps/web/lib/resumable-stream-context.ts`
- `apps/web/lib/abortable-chat-transport.ts`
- Redis-specific stop/resume wiring tied only to chat streaming

## Suggested Rollout

### Phase 1: Durable runtime scaffold

- add dependencies
- add durable agent wrapper
- add workflow chat entrypoint
- keep existing web route behavior as fallback

### Phase 2: Reconnect-safe tool migration

Port the sandbox-backed tools to reconnect inside step execution:

- read
n- write / edit
- bash
- glob
- grep
- skill

### Phase 3: Web transport migration

- move web chat route to workflow start/resume/stop
- move client to `WorkflowChatTransport`
- replace Redis resume/cancel usage for chat

### Phase 4: Handle difficult cases

- durable-safe `task` behavior
- unsupported sandbox state fallback behavior
- cleanup of unused resumable-stream code

## Risks / Open Questions

### `task` tool parity

The `task` tool currently depends on progressive subagent output. A full durable port may need its own follow-up design.

### Unsupported sandbox states

If the session is using:

- `just-bash`, or
- `hybrid` without a `sandboxId`

then reconnect-per-tool is not enough on its own. Those states either need a fallback to the current path or a more advanced state-threading design.

### Type inference

Current app types derive from the singleton agent instance in:

- `apps/web/app/types.ts`
- `apps/cli/tui/types.ts`

A durable runtime may require exporting explicit types instead of relying on singleton inference everywhere.

## Verification Plan

Run project checks with the repo scripts:

- `bun run typecheck`
- `bun run lint`
- `bun test`
- `bun run build`
- `bun run ci`

Manual validation:

- start a long-running chat and reconnect mid-stream
- stop a running chat and confirm cancellation works
- verify file mutations from multiple tool calls persist across durable steps
- verify skill discovery and execution still work
- verify usage and assistant message persistence still happen on completion
- verify unsupported sandbox states either fall back cleanly or are explicitly blocked

## Final Recommendation

Implement durable agent support as a new web-first execution path and keep the current `ToolLoopAgent` as the compatibility runtime.

The most important migration rule is:

- anything crossing workflow/step boundaries must be serializable
- therefore, sandbox-backed tools must reconnect inside their durable execute helpers instead of reading a live sandbox from context

That is the central refactor that should shape the rest of the design.