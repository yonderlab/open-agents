import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

interface AnthropicApiModel {
  id: string;
  display_name?: string;
  type?: string;
}

const anthropicModels: AnthropicApiModel[] = [];
const requestedUrls: string[] = [];

let anthropicStatus = 200;
let modelsDevApiData: unknown = {};
let currentSession: {
  authProvider?: "vercel" | "github";
  user: { id: string; email?: string; username?: string; avatar?: string };
} | null = null;

const originalFetch = globalThis.fetch;
const originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY;

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

mock.module("server-only", () => ({}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => currentSession,
}));

const routeModulePromise = import("./route");

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalAnthropicApiKey === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = originalAnthropicApiKey;
  }
});

describe("/api/models context window enrichment", () => {
  beforeEach(() => {
    anthropicModels.length = 0;
    requestedUrls.length = 0;
    anthropicStatus = 200;
    modelsDevApiData = {};
    currentSession = null;
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

    globalThis.fetch = mock((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = getRequestUrl(input);
      requestedUrls.push(url);

      if (url.startsWith("https://api.anthropic.com/v1/models")) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: anthropicModels }), {
            status: anthropicStatus,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      return Promise.resolve(
        new Response(JSON.stringify(modelsDevApiData), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;
  });

  test("enriches anthropic models with context windows from models.dev", async () => {
    anthropicModels.push(
      {
        id: "claude-opus-4-6",
        display_name: "Claude Opus 4.6",
        type: "model",
      },
      {
        id: "claude-haiku-4-5",
        display_name: "Claude Haiku 4.5",
        type: "model",
      },
    );

    modelsDevApiData = {
      anthropic: {
        models: {
          "claude-opus-4-6": {
            limit: { context: 1_000_000 },
          },
          "claude-haiku-4-5": {
            limit: { context: 200_000 },
          },
        },
      },
    };

    const { GET } = await routeModulePromise;
    const response = await GET(new Request("http://localhost/api/models"));

    expect(response.ok).toBe(true);

    const body = (await response.json()) as {
      models: Array<{ id: string; context_window?: number }>;
    };
    const contextById = new Map(
      body.models.map((model) => [model.id, model.context_window]),
    );

    expect(contextById.get("anthropic/claude-opus-4-6")).toBe(1_000_000);
    expect(contextById.get("anthropic/claude-haiku-4-5")).toBe(200_000);
    expect(requestedUrls).toContain("https://api.anthropic.com/v1/models");
    expect(requestedUrls).toContain("https://models.dev/api.json");
  });

  test("hides Claude Opus models for managed trial users", async () => {
    anthropicModels.push(
      {
        id: "claude-opus-4-6",
        display_name: "Claude Opus 4.6",
        type: "model",
      },
      {
        id: "claude-haiku-4-5",
        display_name: "Claude Haiku 4.5",
        type: "model",
      },
    );
    currentSession = {
      authProvider: "vercel",
      user: { id: "user-1", email: "person@example.com" },
    };

    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("https://open-agents.dev/api/models"),
    );
    const body = (await response.json()) as {
      models: Array<{ id: string }>;
    };

    expect(body.models.map((model) => model.id)).toEqual([
      "anthropic/claude-haiku-4-5",
    ]);
  });

  test("keeps valid models.dev metadata when sibling fields are invalid", async () => {
    anthropicModels.push({
      id: "claude-opus-4-6",
      display_name: "Claude Opus 4.6",
      type: "model",
    });

    modelsDevApiData = {
      invalidProvider: "bad",
      anthropic: {
        models: {
          "claude-opus-4-6": {
            limit: { context: "400_000" },
            cost: {
              input: 1.25,
              output: 10,
              context_over_200k: {
                input: 2.5,
              },
            },
          },
          broken: {
            limit: { context: "not-a-number" },
            cost: { input: "expensive" },
          },
        },
      },
    };

    const { GET } = await routeModulePromise;
    const response = await GET(new Request("http://localhost/api/models"));

    expect(response.ok).toBe(true);

    const body = (await response.json()) as {
      models: Array<{
        id: string;
        context_window?: number;
        cost?: {
          input?: number;
          output?: number;
          context_over_200k?: {
            input?: number;
          };
        };
      }>;
    };

    expect(body.models).toHaveLength(1);
    expect(body.models[0]).toMatchObject({
      id: "anthropic/claude-opus-4-6",
      cost: {
        input: 1.25,
        output: 10,
        context_over_200k: {
          input: 2.5,
        },
      },
    });
  });

  test("returns empty list when anthropic api key is not configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const { GET } = await routeModulePromise;
    const response = await GET(new Request("http://localhost/api/models"));

    expect(response.ok).toBe(true);

    const body = (await response.json()) as {
      models: Array<{ id: string }>;
    };

    expect(body.models).toEqual([]);
    expect(requestedUrls).not.toContain("https://api.anthropic.com/v1/models");
  });

  test("returns empty list when anthropic api responds with error", async () => {
    anthropicStatus = 401;

    const { GET } = await routeModulePromise;
    const response = await GET(new Request("http://localhost/api/models"));

    expect(response.ok).toBe(true);

    const body = (await response.json()) as {
      models: Array<{ id: string }>;
    };

    expect(body.models).toEqual([]);
  });
});
