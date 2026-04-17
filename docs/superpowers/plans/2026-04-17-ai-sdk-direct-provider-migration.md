# AI SDK Direct Provider Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Vercel AI Gateway dependency. Route model IDs like `"anthropic/claude-opus-4.6"` directly to `@ai-sdk/anthropic` (and `@ai-sdk/openai`, optional) via the AI SDK's `createProviderRegistry`.

**Architecture:** Rewrite `gateway()` → `model()` in `packages/agent/models.ts` using a module-scoped provider registry. All call sites (including those currently importing `gateway` from `"ai"` directly) switch to the unified `model()` function exported by `@open-harness/agent`.

**Tech Stack:** TypeScript, Bun, Vercel AI SDK (`ai` v6), `@ai-sdk/anthropic` v3, `@ai-sdk/openai` v3, Turborepo.

**Spec:** `docs/superpowers/specs/2026-04-17-ai-sdk-direct-provider-migration-design.md`

---

## File Structure

**Files modified:**
- `packages/agent/models.ts` — rewrite `gateway()` → `model()` using `createProviderRegistry`
- `packages/agent/index.ts` — update re-export from `gateway` → `model`
- `packages/agent/open-harness-agent.ts` — update 3 internal call sites + import
- `packages/agent/subagents/design.ts` — switch from `ai.gateway` to `@open-harness/agent.model`
- `packages/agent/subagents/explorer.ts` — same
- `packages/agent/subagents/executor.ts` — same
- `apps/web/lib/git/pr-content.ts` — rename `gateway` → `model`
- `apps/web/lib/chat/auto-commit-direct.ts` — rename `gateway` → `model`
- `apps/web/app/api/generate-pr/route.ts` — switch from `ai.gateway` to `@open-harness/agent.model`
- `apps/web/app/api/generate-title/route.ts` — same
- `apps/web/app/api/sessions/[sessionId]/generate-commit-message/route.ts` — same
- `apps/web/app/api/sessions/[sessionId]/checks/fix/route.ts` — same
- `apps/web/app/api/github/create-repo/_lib/create-repo-workflow.ts` — same
- `apps/web/.env.example` — add `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`

---

## Task 1: Rewrite `packages/agent/models.ts`

**Files:**
- Modify: `packages/agent/models.ts` (full rewrite of imports, `gateway` → `model`, and body)

- [ ] **Step 1: Open the current file and keep a scratch copy of the logic to preserve**

The following helpers and exports must survive the rewrite:
- `getAnthropicSettings()`
- `isJsonObject()`, `toProviderOptionsRecord()`, `mergeRecords()`
- `mergeProviderOptions()` (exported)
- `ProviderOptionsByProvider` type (exported)
- `shouldApplyOpenAIReasoningDefaults()` (exported)
- `shouldApplyOpenAITextVerbosityDefaults()` (private)
- `getProviderOptionsForModel()` (exported)
- Type re-exports: `GatewayModelId`, `LanguageModel`, `JSONValue`

Dropped:
- `createGateway`, `aiGateway` imports
- `GatewayConfig` interface (and its re-export)
- `GatewayOptions.config` field
- `gateway()` function (replaced by `model()`)

- [ ] **Step 2: Replace the file with the following content**

```typescript
import type { AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import { createOpenAI } from "@ai-sdk/openai";
import {
  createProviderRegistry,
  defaultSettingsMiddleware,
  wrapLanguageModel,
  type GatewayModelId,
  type JSONValue,
  type LanguageModel,
} from "ai";

// Models with 4.5+ support adaptive thinking with effort control.
// Older models use the legacy extended thinking API with a budget.
function getAnthropicSettings(modelId: string): AnthropicLanguageModelOptions {
  if (modelId.includes("4.6")) {
    return {
      effort: "medium",
      thinking: { type: "adaptive" },
    } satisfies AnthropicLanguageModelOptions;
  }

  return {
    thinking: { type: "enabled", budgetTokens: 8000 },
  };
}

function isJsonObject(value: unknown): value is Record<string, JSONValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toProviderOptionsRecord(
  options: Record<string, unknown>,
): Record<string, JSONValue> {
  return options as Record<string, JSONValue>;
}

function mergeRecords(
  base: Record<string, JSONValue>,
  override: Record<string, JSONValue>,
): Record<string, JSONValue> {
  const merged: Record<string, JSONValue> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    const existingValue = merged[key];

    if (isJsonObject(existingValue) && isJsonObject(value)) {
      merged[key] = mergeRecords(existingValue, value);
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

export type ProviderOptionsByProvider = Record<
  string,
  Record<string, JSONValue>
>;

export function mergeProviderOptions(
  defaults: ProviderOptionsByProvider,
  overrides?: ProviderOptionsByProvider,
): ProviderOptionsByProvider {
  if (!overrides || Object.keys(overrides).length === 0) {
    return defaults;
  }

  const merged: ProviderOptionsByProvider = { ...defaults };

  for (const [provider, providerOverrides] of Object.entries(overrides)) {
    const providerDefaults = merged[provider];

    if (!providerDefaults) {
      merged[provider] = providerOverrides;
      continue;
    }

    merged[provider] = mergeRecords(providerDefaults, providerOverrides);
  }

  return merged;
}

export interface ModelOptions {
  providerOptionsOverrides?: ProviderOptionsByProvider;
}

export type { GatewayModelId, LanguageModel, JSONValue };

export function shouldApplyOpenAIReasoningDefaults(modelId: string): boolean {
  return modelId.startsWith("openai/gpt-5");
}

function shouldApplyOpenAITextVerbosityDefaults(modelId: string): boolean {
  return modelId.startsWith("openai/gpt-5.4");
}

export function getProviderOptionsForModel(
  modelId: string,
  providerOptionsOverrides?: ProviderOptionsByProvider,
): ProviderOptionsByProvider {
  const defaultProviderOptions: ProviderOptionsByProvider = {};

  // Apply anthropic defaults
  if (modelId.startsWith("anthropic/")) {
    defaultProviderOptions.anthropic = toProviderOptionsRecord(
      getAnthropicSettings(modelId),
    );
  }

  // OpenAI model responses should never be persisted.
  if (modelId.startsWith("openai/")) {
    defaultProviderOptions.openai = toProviderOptionsRecord({
      store: false,
    } satisfies OpenAIResponsesProviderOptions);
  }

  // Apply OpenAI defaults for all GPT-5 variants to expose encrypted reasoning content.
  // This avoids Responses API failures when `store: false`, e.g.:
  // "Item with id 'rs_...' not found. Items are not persisted when `store` is set to false."
  if (shouldApplyOpenAIReasoningDefaults(modelId)) {
    defaultProviderOptions.openai = mergeRecords(
      defaultProviderOptions.openai ?? {},
      toProviderOptionsRecord({
        reasoningSummary: "detailed",
        include: ["reasoning.encrypted_content"],
      } satisfies OpenAIResponsesProviderOptions),
    );
  }

  if (shouldApplyOpenAITextVerbosityDefaults(modelId)) {
    defaultProviderOptions.openai = mergeRecords(
      defaultProviderOptions.openai ?? {},
      toProviderOptionsRecord({
        textVerbosity: "low",
      } satisfies OpenAIResponsesProviderOptions),
    );
  }

  const providerOptions = mergeProviderOptions(
    defaultProviderOptions,
    providerOptionsOverrides,
  );

  // Enforce OpenAI non-persistence even when custom provider overrides are present.
  if (modelId.startsWith("openai/")) {
    providerOptions.openai = mergeRecords(
      providerOptions.openai ?? {},
      toProviderOptionsRecord({
        store: false,
      } satisfies OpenAIResponsesProviderOptions),
    );
  }

  return providerOptions;
}

// Vercel's AI Gateway uses dotted version suffixes (e.g. "claude-opus-4.6")
// while provider SDKs expect hyphen-separated IDs (e.g. "claude-opus-4-6").
// Normalize so existing GatewayModelId strings keep working when routed directly.
function normalizeModelIdForProvider(providerModelId: string): string {
  return providerModelId.replaceAll(".", "-");
}

// Registry is module-scoped so providers are constructed once per process.
// Auth is picked up from env vars (ANTHROPIC_API_KEY, OPENAI_API_KEY) by each SDK.
// OpenAI is wired up but optional — only fails at request time if no key is set.
// The `separator: "/"` option matches our model-id format ("anthropic/claude-opus-4.6").
// The default separator is ":", so this must be set explicitly.
const registry = createProviderRegistry(
  {
    anthropic: createAnthropic(),
    openai: createOpenAI(),
  },
  { separator: "/" },
);

export function model(
  modelId: GatewayModelId,
  options: ModelOptions = {},
): LanguageModel {
  const { providerOptionsOverrides } = options;

  const [providerId, ...rest] = modelId.split("/");
  const providerModelId = rest.join("/");

  if (!providerId || !providerModelId) {
    throw new Error(
      `Invalid model id "${modelId}". Expected "provider/model" format.`,
    );
  }

  const normalizedId = `${providerId}/${normalizeModelIdForProvider(providerModelId)}` as const;

  let resolved: LanguageModel = registry.languageModel(
    normalizedId as Parameters<typeof registry.languageModel>[0],
  );

  const providerOptions = getProviderOptionsForModel(
    modelId,
    providerOptionsOverrides,
  );

  if (Object.keys(providerOptions).length > 0) {
    resolved = wrapLanguageModel({
      model: resolved,
      middleware: defaultSettingsMiddleware({
        settings: { providerOptions },
      }),
    });
  }

  return resolved;
}
```

- [ ] **Step 3: Verify the file type-checks in isolation**

Run: `bun run --cwd packages/agent typecheck` (or `turbo typecheck --filter=@open-harness/agent`)

Expected: **FAIL** — `gateway` is still referenced by `open-harness-agent.ts` and `index.ts`. This is expected at this stage; Task 2 fixes `index.ts` and Task 3 fixes `open-harness-agent.ts`.

- [ ] **Step 4: Commit**

```bash
git add packages/agent/models.ts
git commit -m "refactor(agent): replace Vercel gateway with provider registry"
```

---

## Task 2: Update `packages/agent/index.ts` exports

**Files:**
- Modify: `packages/agent/index.ts:1`

- [ ] **Step 1: Replace the `gateway` export line**

Current line 1:
```typescript
export { type GatewayConfig, type GatewayOptions, gateway } from "./models";
```

Replace with:
```typescript
export { model, type ModelOptions } from "./models";
```

Note: `GatewayConfig` and `GatewayOptions` no longer exist. `ModelOptions` is the replacement. Do not re-add deprecated aliases — grep will verify no external consumers reference them.

- [ ] **Step 2: Verify no external consumer imports `GatewayConfig` or `GatewayOptions`**

Run: `rg "GatewayConfig|GatewayOptions" --type ts` from repo root.

Expected: no matches outside `packages/agent/models.ts` (which was already updated). If matches exist in apps/web, they must be updated — they are not expected based on exploration.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/index.ts
git commit -m "refactor(agent): export model in place of gateway"
```

---

## Task 3: Update `packages/agent/open-harness-agent.ts`

**Files:**
- Modify: `packages/agent/open-harness-agent.ts:5-9, 52, 106, 110`

- [ ] **Step 1: Update the import block**

Current lines 5-9:
```typescript
import {
  type GatewayModelId,
  gateway,
  type ProviderOptionsByProvider,
} from "./models";
```

Replace with:
```typescript
import {
  type GatewayModelId,
  model,
  type ProviderOptionsByProvider,
} from "./models";
```

- [ ] **Step 2: Update line 52**

Current:
```typescript
export const defaultModel = gateway(defaultModelLabel);
```

Replace with:
```typescript
export const defaultModel = model(defaultModelLabel);
```

- [ ] **Step 3: Update lines 106-113**

Current:
```typescript
    const callModel = gateway(mainSelection.id, {
      providerOptionsOverrides: mainSelection.providerOptionsOverrides,
    });
    const subagentModel = subagentSelection
      ? gateway(subagentSelection.id, {
          providerOptionsOverrides: subagentSelection.providerOptionsOverrides,
        })
      : undefined;
```

Replace `gateway(` with `model(` (two occurrences on lines 106 and 110).

Final:
```typescript
    const callModel = model(mainSelection.id, {
      providerOptionsOverrides: mainSelection.providerOptionsOverrides,
    });
    const subagentModel = subagentSelection
      ? model(subagentSelection.id, {
          providerOptionsOverrides: subagentSelection.providerOptionsOverrides,
        })
      : undefined;
```

- [ ] **Step 4: Verify the agent package type-checks**

Run: `turbo typecheck --filter=@open-harness/agent`

Expected: **PASS**. The agent package now compiles cleanly. Subagent files are expected to still fail; those are Task 4.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/open-harness-agent.ts
git commit -m "refactor(agent): route open-harness-agent through model()"
```

---

## Task 4: Update the three subagent files

**Files:**
- Modify: `packages/agent/subagents/design.ts:2, 92`
- Modify: `packages/agent/subagents/explorer.ts:2, 77`
- Modify: `packages/agent/subagents/executor.ts:2, 62`

These currently import `gateway` from `"ai"` (Vercel's gateway). They must switch to our `model()` from `../models`.

- [ ] **Step 1: Update `design.ts` imports and call site**

Current line 2:
```typescript
import { gateway, stepCountIs, ToolLoopAgent } from "ai";
```

Replace with:
```typescript
import { stepCountIs, ToolLoopAgent } from "ai";
import { model } from "../models";
```

Current line 92:
```typescript
  model: gateway("anthropic/claude-opus-4.6"),
```

Replace with:
```typescript
  model: model("anthropic/claude-opus-4.6"),
```

- [ ] **Step 2: Update `explorer.ts` imports and call site**

Current line 2:
```typescript
import { gateway, stepCountIs, ToolLoopAgent } from "ai";
```

Replace with:
```typescript
import { stepCountIs, ToolLoopAgent } from "ai";
import { model } from "../models";
```

Current line 77:
```typescript
  model: gateway("anthropic/claude-haiku-4.5"),
```

Replace with:
```typescript
  model: model("anthropic/claude-haiku-4.5"),
```

- [ ] **Step 3: Update `executor.ts` imports and call site**

Current line 2:
```typescript
import { gateway, stepCountIs, ToolLoopAgent } from "ai";
```

Replace with:
```typescript
import { stepCountIs, ToolLoopAgent } from "ai";
import { model } from "../models";
```

Current line 62:
```typescript
  model: gateway("anthropic/claude-haiku-4.5"),
```

Replace with:
```typescript
  model: model("anthropic/claude-haiku-4.5"),
```

- [ ] **Step 4: Verify the agent package type-checks fully**

Run: `turbo typecheck --filter=@open-harness/agent`

Expected: **PASS**.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/subagents/design.ts packages/agent/subagents/explorer.ts packages/agent/subagents/executor.ts
git commit -m "refactor(agent): route subagents through model()"
```

---

## Task 5: Update `apps/web` files already using our wrapper

These files already import from `@open-harness/agent` — just a rename from `gateway` to `model`.

**Files:**
- Modify: `apps/web/lib/git/pr-content.ts:2, 305`
- Modify: `apps/web/lib/chat/auto-commit-direct.ts:3, 162`

- [ ] **Step 1: Update `pr-content.ts`**

Current line 2:
```typescript
import { gateway } from "@open-harness/agent";
```

Replace with:
```typescript
import { model } from "@open-harness/agent";
```

Current line 305:
```typescript
    model: gateway("anthropic/claude-haiku-4.5"),
```

Replace with:
```typescript
    model: model("anthropic/claude-haiku-4.5"),
```

- [ ] **Step 2: Update `auto-commit-direct.ts`**

Current line 3:
```typescript
import { gateway } from "@open-harness/agent";
```

Replace with:
```typescript
import { model } from "@open-harness/agent";
```

Current line 162:
```typescript
      model: gateway("anthropic/claude-haiku-4.5"),
```

Replace with:
```typescript
      model: model("anthropic/claude-haiku-4.5"),
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/git/pr-content.ts apps/web/lib/chat/auto-commit-direct.ts
git commit -m "refactor(web): rename gateway → model in wrapper consumers"
```

---

## Task 6: Migrate `apps/web` files importing `gateway` from `"ai"` directly

These files currently bypass our wrapper and call Vercel's gateway directly. They must switch to `model` from `@open-harness/agent` so they pick up provider-option defaults.

**Files:**
- Modify: `apps/web/app/api/generate-pr/route.ts:4, 322`
- Modify: `apps/web/app/api/generate-title/route.ts:3, 21`
- Modify: `apps/web/app/api/sessions/[sessionId]/generate-commit-message/route.ts:4, 51`
- Modify: `apps/web/app/api/sessions/[sessionId]/checks/fix/route.ts:8, 162`
- Modify: `apps/web/app/api/github/create-repo/_lib/create-repo-workflow.ts:2, 200`

Each file follows the same pattern.

- [ ] **Step 1: Update `generate-pr/route.ts`**

Current line 4:
```typescript
import { gateway, generateText } from "ai";
```

Replace with:
```typescript
import { generateText } from "ai";
import { model } from "@open-harness/agent";
```

Line 322: `gateway("anthropic/claude-haiku-4.5")` → `model("anthropic/claude-haiku-4.5")`.

- [ ] **Step 2: Update `generate-title/route.ts`**

Current line 3:
```typescript
import { gateway, generateText } from "ai";
```

Replace with:
```typescript
import { generateText } from "ai";
import { model } from "@open-harness/agent";
```

Line 21: `gateway("anthropic/claude-haiku-4.5")` → `model("anthropic/claude-haiku-4.5")`.

- [ ] **Step 3: Update `generate-commit-message/route.ts`**

Current line 4:
```typescript
import { gateway, generateText } from "ai";
```

Replace with:
```typescript
import { generateText } from "ai";
import { model } from "@open-harness/agent";
```

Line 51: `gateway("anthropic/claude-haiku-4.5")` → `model("anthropic/claude-haiku-4.5")`.

- [ ] **Step 4: Update `checks/fix/route.ts`**

Current line 8:
```typescript
import { gateway, generateText } from "ai";
```

Replace with:
```typescript
import { generateText } from "ai";
import { model } from "@open-harness/agent";
```

Line 162: `gateway("anthropic/claude-haiku-4.5")` → `model("anthropic/claude-haiku-4.5")`.

- [ ] **Step 5: Update `create-repo-workflow.ts`**

Current line 2:
```typescript
import { gateway, generateText } from "ai";
```

Replace with:
```typescript
import { generateText } from "ai";
import { model } from "@open-harness/agent";
```

Line 200: `gateway("anthropic/claude-haiku-4.5")` → `model("anthropic/claude-haiku-4.5")`.

- [ ] **Step 6: Verify the web app type-checks**

Run: `turbo typecheck --filter=web`

Expected: **PASS**.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/app/api/generate-pr/route.ts" "apps/web/app/api/generate-title/route.ts" "apps/web/app/api/sessions/[sessionId]/generate-commit-message/route.ts" "apps/web/app/api/sessions/[sessionId]/checks/fix/route.ts" "apps/web/app/api/github/create-repo/_lib/create-repo-workflow.ts"
git commit -m "refactor(web): route API routes through @open-harness/agent model()"
```

---

## Task 7: Update `apps/web/.env.example`

**Files:**
- Modify: `apps/web/.env.example:30-31`

- [ ] **Step 1: Add provider API keys before the "Optional integrations" section**

Current lines 30-31:
```
# Optional integrations
ELEVENLABS_API_KEY=
```

Replace with:
```
# AI provider API keys
# Required: Anthropic is the primary provider
ANTHROPIC_API_KEY=

# Optional: only needed when invoking openai/* models
OPENAI_API_KEY=

# Optional integrations
ELEVENLABS_API_KEY=
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/.env.example
git commit -m "docs(web): add ANTHROPIC_API_KEY and OPENAI_API_KEY to env.example"
```

---

## Task 8: Stale-reference cleanup & full CI

- [ ] **Step 1: Grep for stale references**

Run from repo root:
```bash
rg "aiGateway|createGateway|GatewayConfig|GatewayOptions" --type ts
rg "AI_GATEWAY_API_KEY" .
rg "from [\"']ai[\"']" --type ts -l | xargs rg -l "gateway"
```

Expected: **no matches** in production code. Matches in:
- `docs/superpowers/specs/` and `docs/superpowers/plans/` (this plan + spec) are fine.
- `.agents/skills/ai-sdk/references/ai-gateway.md` — skill reference doc, leave alone unless it appears in CI.

If any other file matches, update it to use `model` from `@open-harness/agent`.

- [ ] **Step 2: Run full CI**

Run: `bun run ci`

Expected: **PASS** — format check, lint, typecheck, and all existing tests pass.

If tests fail because they mock `gateway`, update the mocks to mock `model` instead. Only a finding at this point should require changes.

- [ ] **Step 3: Manual smoke test**

Ensure `.env.local` in `apps/web` has `ANTHROPIC_API_KEY=<a real key>` set. `OPENAI_API_KEY` may be unset.

Start the dev server:
```bash
bun run web
```

In the browser:
1. Open a session.
2. Send a chat message to the agent.
3. Confirm a streamed response arrives without errors.
4. Trigger a flow that uses the haiku model (e.g., session title generation after sending the first message).
5. Confirm the title is generated.

Expected: Both the main agent loop (`claude-opus-4.6`) and the haiku utility calls succeed. If any 4xx auth error appears, check that `ANTHROPIC_API_KEY` is set.

**Fallback if model IDs fail at the Anthropic API:** The `normalizeModelIdForProvider()` helper in `models.ts` converts `"claude-opus-4.6"` → `"claude-opus-4-6"`. If Anthropic returns a 404 "model not found" error, update `defaultModelLabel` and the hardcoded model IDs in subagent/route files to use the actual Anthropic model alias for the current version (e.g., `"anthropic/claude-opus-4-20250514"` or whatever the current Anthropic ID is). This is a content change, not a structural one — the plumbing is correct.

- [ ] **Step 4: Final commit (only if fixes from smoke test were needed)**

If model IDs needed adjustment:
```bash
git add <files>
git commit -m "fix(agent): align model IDs with Anthropic API format"
```

Otherwise no additional commit needed.

---

## Summary Checklist

- [ ] Task 1: Rewrite `models.ts` with provider registry
- [ ] Task 2: Update `index.ts` exports
- [ ] Task 3: Update `open-harness-agent.ts` (3 call sites)
- [ ] Task 4: Update 3 subagent files
- [ ] Task 5: Update 2 files already importing from `@open-harness/agent`
- [ ] Task 6: Migrate 5 API-route files from `ai.gateway` to our `model()`
- [ ] Task 7: Update `.env.example`
- [ ] Task 8: Stale-reference cleanup, full CI, manual smoke test
