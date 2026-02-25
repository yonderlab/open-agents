"use client";

import useSWR from "swr";
import type {
  GetInboxResponse,
  InboxActionRequest,
  InboxActionResponse,
} from "@/lib/inbox/types";
import { fetcher } from "@/lib/swr";

export interface UseInboxOptions {
  q?: string;
  includeUpdates?: boolean;
  enabled?: boolean;
}

function buildInboxUrl(options: UseInboxOptions): string {
  const params = new URLSearchParams();

  if (options.q && options.q.trim().length > 0) {
    params.set("q", options.q.trim());
  }

  if (options.includeUpdates) {
    params.set("includeUpdates", "true");
  }

  const queryString = params.toString();
  return queryString ? `/api/inbox?${queryString}` : "/api/inbox";
}

export function useInbox(options?: UseInboxOptions) {
  const enabled = options?.enabled ?? true;
  const key = enabled ? buildInboxUrl(options ?? {}) : null;

  const { data, error, isLoading, mutate } = useSWR<GetInboxResponse>(
    key,
    fetcher,
    {
      revalidateOnFocus: true,
      refreshInterval: 15000,
    },
  );

  const runAction = async (
    request: InboxActionRequest,
  ): Promise<InboxActionResponse> => {
    const response = await fetch("/api/inbox/actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    const payload = (await response.json()) as
      | InboxActionResponse
      | { error?: string };

    if (!response.ok) {
      throw new Error(
        "error" in payload && payload.error
          ? payload.error
          : "Failed to run inbox action",
      );
    }

    return payload as InboxActionResponse;
  };

  return {
    data: data ?? null,
    loading: isLoading,
    error: error ?? null,
    refresh: async () => {
      await mutate();
    },
    runAction,
  };
}
