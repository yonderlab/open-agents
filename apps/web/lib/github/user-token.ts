import "server-only";
import { decrypt, encrypt } from "@/lib/crypto";
import { getGitHubAccount, updateGitHubAccountTokens } from "@/lib/db/accounts";
import { getServerSession } from "@/lib/session/get-server-session";

interface GitHubTokenRefreshResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_token_expires_in: number;
  token_type: string;
  scope: string;
}

/**
 * Refresh an expired GitHub user token using the refresh token.
 * GitHub's expiring user tokens last ~8 hours; refresh tokens last ~6 months.
 * See: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens
 */
async function refreshGitHubToken(
  refreshToken: string,
): Promise<GitHubTokenRefreshResponse | null> {
  const clientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) return null;

  try {
    const response = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      },
    );

    if (!response.ok) {
      console.error(
        `GitHub token refresh returned HTTP ${response.status}: ${response.statusText}`,
      );
      return null;
    }

    const data = (await response.json()) as
      | GitHubTokenRefreshResponse
      | { error: string; error_description?: string };

    if ("error" in data) {
      console.error(
        "GitHub token refresh failed:",
        data.error,
        data.error_description,
      );
      return null;
    }

    return data;
  } catch (error) {
    console.error("GitHub token refresh error:", error);
    return null;
  }
}

export type UserTokenStatus =
  | "valid"
  | "no_account"
  | "refresh_failed"
  | "no_refresh_token";

export type UserTokenResult =
  | { token: string; status: "valid" }
  | {
      token: null;
      status: "no_account" | "refresh_failed" | "no_refresh_token";
    };

/**
 * Get a valid GitHub user-to-server access token with status information.
 * Returns a discriminated union so callers can distinguish between
 * "no account linked" and "token expired and refresh failed".
 */
export async function getUserGitHubTokenWithStatus(
  userId?: string,
): Promise<UserTokenResult> {
  const resolvedUserId = userId ?? (await getServerSession())?.user?.id;
  if (!resolvedUserId) return { token: null, status: "no_account" };

  try {
    const ghAccount = await getGitHubAccount(resolvedUserId);
    if (!ghAccount?.accessToken) return { token: null, status: "no_account" };

    // If no expiration is set, the token is non-expiring (classic OAuth)
    if (!ghAccount.expiresAt) {
      return { token: decrypt(ghAccount.accessToken), status: "valid" };
    }

    // Check if the token is still valid (with 5-minute buffer)
    const now = Date.now();
    const bufferMs = 5 * 60 * 1000;
    const isExpired = ghAccount.expiresAt.getTime() - bufferMs < now;

    if (!isExpired) {
      return { token: decrypt(ghAccount.accessToken), status: "valid" };
    }

    // Token is expired -- try to refresh
    if (!ghAccount.refreshToken) {
      console.error("GitHub token expired but no refresh token available");
      return { token: null, status: "no_refresh_token" };
    }

    const decryptedRefresh = decrypt(ghAccount.refreshToken);
    const refreshed = await refreshGitHubToken(decryptedRefresh);
    if (!refreshed) return { token: null, status: "refresh_failed" };

    // Persist the new tokens. If persistence fails, still return the token
    // so the current request succeeds. The refresh token has already been
    // consumed by GitHub (they rotate on use), so failing to persist would
    // permanently break the user's connection on the next request.
    const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
    try {
      await updateGitHubAccountTokens(resolvedUserId, {
        accessToken: encrypt(refreshed.access_token),
        refreshToken: encrypt(refreshed.refresh_token),
        expiresAt: newExpiresAt,
      });
    } catch (persistError) {
      console.error(
        "Failed to persist refreshed GitHub tokens. The current request will succeed, but subsequent requests may fail:",
        persistError,
      );
    }

    return { token: refreshed.access_token, status: "valid" };
  } catch (error) {
    console.error("Error fetching GitHub token:", error);
    return { token: null, status: "refresh_failed" };
  }
}

/**
 * Get a valid GitHub access token for the given user.
 * If no userId is provided, falls back to the current request session.
 * If the token is expired and a refresh token exists, refreshes inline
 * and updates the database (mirroring the Vercel token refresh flow).
 */
export async function getUserGitHubToken(
  userId?: string,
): Promise<string | null> {
  const result = await getUserGitHubTokenWithStatus(userId);
  return result.token;
}
