# AI SDK Direct Provider Migration

## Context

This repo is a fork of an open-source template built on Vercel's AI Gateway product. We want to adapt it for internal use where we call Anthropic (and eventually OpenAI) directly using our own API keys, without routing through Vercel's gateway.

Today, `packages/agent/models.ts` exposes a `gateway()` function that resolves model IDs like `"anthropic/claude-opus-4.6"` through `ai.gateway` / `createGateway`. Every call site (~6 usages across `apps/web` and `packages/agent`) goes through this function.

## Goal

Remove the Vercel AI Gateway dependency. Route model IDs directly to `@ai-sdk/anthropic` and `@ai-sdk/openai` via the AI SDK's built-in `createProviderRegistry`. OpenAI support is wired up but optional — the app runs fine with only `ANTHROPIC_API_KEY` set.

## Non-Goals

- No changes to consumer code (agent loop, chat routes, PR/commit generators) beyond swapping the import name.
- No new provider beyond Anthropic and OpenAI.
- No end-to-end validation of the OpenAI path (we don't have a key yet — code is reachable by static analysis only).
- No refactoring of `getProviderOptionsForModel()` — its logic is preserved as-is.

## Architecture

```
model(modelId) → createProviderRegistry({ anthropic, openai }) → provider
              → wrapLanguageModel(defaultSettingsMiddleware(...))
```

A module-scoped registry is built once with `createProviderRegistry({ anthropic: createAnthropic({...}), openai: createOpenAI({...}) })`. The factory function calls `registry.languageModel(modelId)` and wraps the result with the existing `defaultSettingsMiddleware` for provider-option defaults (thinking, reasoning, non-persistence, etc.).

Auth is handled by each provider SDK via env vars — no explicit key passing in code:

- `ANTHROPIC_API_KEY` — required
- `OPENAI_API_KEY` — optional, only needed when invoking `openai/*` models

## Public API

Rename `gateway()` → `model()` in `packages/agent/models.ts`. The signature is:

```ts
export function model(
  modelId: GatewayModelId,
  options?: { providerOptionsOverrides?: ProviderOptionsByProvider }
): LanguageModel
```

**Removed:** the `config?: GatewayConfig` option. No call sites use it.

**Kept:** `GatewayModelId` re-export (the AI SDK's string union of `"provider/model"` IDs remains accurate for the registry).

Call sites update their imports from `gateway` to `model` (~6 files):

- `packages/agent/open-harness-agent.ts`
- `apps/web/app/api/generate-title/route.ts`
- `apps/web/app/api/generate-pr/route.ts`
- `apps/web/app/api/sessions/[sessionId]/generate-commit-message/route.ts`
- `apps/web/lib/chat/auto-commit-direct.ts`
- `apps/web/lib/git/pr-content.ts`

## Provider Options & Middleware

The existing `getProviderOptionsForModel()` function is kept intact. It branches on model-ID prefix and produces provider-option defaults:

- Anthropic: adaptive thinking for 4.6+, legacy budget tokens for older models
- OpenAI: `store: false` (non-persistence), enforced even when overrides are present
- OpenAI GPT-5: `reasoningSummary: "detailed"`, `include: ["reasoning.encrypted_content"]`
- OpenAI GPT-5.4: `textVerbosity: "low"`

These apply equivalently to the registry output because they operate on the model ID and attach provider options via middleware — independent of how the model was instantiated.

The wrapping logic inside `model()`:

```ts
let m: LanguageModel = registry.languageModel(modelId);
const providerOptions = getProviderOptionsForModel(modelId, providerOptionsOverrides);
if (Object.keys(providerOptions).length > 0) {
  m = wrapLanguageModel({
    model: m,
    middleware: defaultSettingsMiddleware({ settings: { providerOptions } }),
  });
}
return m;
```

## Dependencies

No new packages. All required dependencies are already installed at the root:

- `ai` (exports `createProviderRegistry`)
- `@ai-sdk/anthropic` (exports `createAnthropic`)
- `@ai-sdk/openai` (exports `createOpenAI`)

**Imports removed from `models.ts`:** `createGateway`, `gateway as aiGateway`.
**Imports added to `models.ts`:** `createProviderRegistry`, `createAnthropic`, `createOpenAI`.

## Env Config

Update `apps/web/.env.example`:

```
# Required
ANTHROPIC_API_KEY=

# Optional — only needed when invoking openai/* models
OPENAI_API_KEY=

# Optional integrations
ELEVENLABS_API_KEY=
```

Any `AI_GATEWAY_API_KEY` references (if present) are removed during implementation. Verify via grep.

## Optional Provider Behavior

Both providers are registered unconditionally. `createOpenAI()` without a key does not throw at construction — it fails only at request time with a clear auth error from the OpenAI SDK. This gives us:

- App starts and runs with only `ANTHROPIC_API_KEY` set.
- Any attempt to invoke an `openai/*` model without a key fails loudly at the call site.
- No conditional-registry or startup-validation complexity.

## Testing & Verification

1. **Type check:** `turbo typecheck --filter=@open-harness/agent` and `turbo typecheck --filter=web` must pass.
2. **Full CI:** `bun run ci` (format + lint + typecheck + tests).
3. **Manual smoke test:** run `bun run web` with only `ANTHROPIC_API_KEY` set, trigger a chat, confirm a response streams back. Exercise `anthropic/claude-opus-4.6` (main agent) and `anthropic/claude-haiku-4.5` (commit messages, titles).
4. **Stale-reference grep:** search for `aiGateway`, `createGateway`, `GatewayConfig`, `AI_GATEWAY_API_KEY` and confirm nothing remains.

No new unit tests are added — the change is a provider-plumbing swap with identical behavior at the AI SDK call-site level. Existing tests exercise the downstream code paths.

## Summary of Changes

- **`packages/agent/models.ts`** — rewrite `gateway()` → `model()` using `createProviderRegistry`. Drop `GatewayConfig` and gateway imports.
- **~6 call sites** — find-replace `gateway(` → `model(` and update imports.
- **`apps/web/.env.example`** — document `ANTHROPIC_API_KEY` (required) and `OPENAI_API_KEY` (optional).
- **Env cleanup** — remove any `AI_GATEWAY_API_KEY` references if present.
