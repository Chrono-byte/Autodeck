import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_BASE_URL = "https://auth.openai.com";
const DEVICE_USER_CODE_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`;
const DEVICE_TOKEN_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/token`;
const DEVICE_VERIFICATION_URI = `${AUTH_BASE_URL}/codex/device`;
const DEVICE_REDIRECT_URI = `${AUTH_BASE_URL}/deviceauth/callback`;
const TOKEN_URL = `${AUTH_BASE_URL}/oauth/token`;
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

type StoredCredential = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId: string;
};

type OAuthLogLevel = "debug" | "info" | "warn" | "error";
const LOG_LEVEL_WEIGHT: Record<OAuthLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]");
}

function logOAuth(level: OAuthLogLevel, event: string, data: Record<string, unknown> = {}) {
  const configured = process.env.LOG_LEVEL?.toLowerCase();
  const minimum: OAuthLogLevel =
    configured === "debug" || configured === "warn" || configured === "error"
      ? configured
      : "info";
  if (LOG_LEVEL_WEIGHT[level] < LOG_LEVEL_WEIGHT[minimum]) return;
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: "autodekt-convex",
    event,
    ...data,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (level === "debug") console.debug(line);
  else console.info(line);
}

async function ownerId(ctx: {
  auth: { getUserIdentity: () => Promise<{ subject: string } | null> };
}) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  return identity.subject;
}

function decodeAccountId(accessToken: string) {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) throw new Error("Invalid token");
    const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
    const base64 = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = JSON.parse(atob(base64)) as Record<string, unknown>;
    const auth = decoded[JWT_CLAIM_PATH] as { chatgpt_account_id?: unknown } | undefined;
    if (typeof auth?.chatgpt_account_id !== "string") throw new Error("Missing account ID");
    return auth.chatgpt_account_id;
  } catch {
    throw new Error("OpenAI returned a token without a ChatGPT account ID");
  }
}

async function readJson(response: Response, label: string) {
  const text = await response.text();
  if (!response.ok) {
    let code = "";
    try {
      const parsed = JSON.parse(text) as { error?: string | { code?: string } };
      code = typeof parsed.error === "string" ? parsed.error : (parsed.error?.code ?? "");
    } catch {
      // Upstream returned a non-JSON error.
    }
    throw new Error(`${label} failed (${response.status})${code ? `: ${code}` : ""}`);
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

export const status = query({
  args: {},
  handler: async (ctx) => {
    const owner = await ownerId(ctx);
    const credential = await ctx.db
      .query("openaiCodexCredentials")
      .withIndex("by_owner", (q) => q.eq("ownerId", owner))
      .unique();
    return credential
      ? { connected: true as const, accountId: credential.accountId }
      : { connected: false as const };
  },
});

export const startDeviceAuth = action({
  args: {},
  handler: async (ctx) => {
    await ownerId(ctx);
    const operationId = crypto.randomUUID();
    const startedAt = Date.now();
    logOAuth("info", "oauth.device.started", { operationId });
    try {
      const response = await fetch(DEVICE_USER_CODE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: CLIENT_ID }),
      });
      const json = await readJson(response, "OpenAI device authorization");
      const deviceAuthId = json.device_auth_id;
      const userCode = json.user_code;
      const rawInterval = typeof json.interval === "string" ? Number(json.interval) : json.interval;
      if (
        typeof deviceAuthId !== "string" ||
        typeof userCode !== "string" ||
        typeof rawInterval !== "number"
      ) {
        throw new Error("OpenAI device authorization returned incomplete data");
      }
      logOAuth("info", "oauth.device.ready", {
        operationId,
        durationMs: Date.now() - startedAt,
        intervalSeconds: Math.max(1, rawInterval),
        expiresInSeconds: 15 * 60,
      });
      return {
        deviceAuthId,
        userCode,
        verificationUri: DEVICE_VERIFICATION_URI,
        intervalSeconds: Math.max(1, rawInterval),
        expiresInSeconds: 15 * 60,
      };
    } catch (error) {
      logOAuth("error", "oauth.device.failed", {
        operationId,
        durationMs: Date.now() - startedAt,
        error: safeError(error),
      });
      throw error;
    }
  },
});

export const pollDeviceAuth = action({
  args: { deviceAuthId: v.string(), userCode: v.string() },
  handler: async (ctx, args) => {
    const owner = await ownerId(ctx);
    const startedAt = Date.now();
    try {
      const response = await fetch(DEVICE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_auth_id: args.deviceAuthId, user_code: args.userCode }),
      });

      if (response.status === 403 || response.status === 404) return { status: "pending" as const };
      const deviceJson = await readJson(response, "OpenAI device authorization check");
      if (
        typeof deviceJson.authorization_code !== "string" ||
        typeof deviceJson.code_verifier !== "string"
      ) {
        throw new Error("OpenAI device authorization check returned incomplete data");
      }

      const tokenResponse = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: CLIENT_ID,
          code: deviceJson.authorization_code,
          code_verifier: deviceJson.code_verifier,
          redirect_uri: DEVICE_REDIRECT_URI,
        }),
      });
      const tokenJson = await readJson(tokenResponse, "OpenAI token exchange");
      if (
        typeof tokenJson.access_token !== "string" ||
        typeof tokenJson.refresh_token !== "string" ||
        typeof tokenJson.expires_in !== "number"
      )
        throw new Error("OpenAI token exchange returned incomplete data");

      await ctx.runMutation(internal.openaiCodex.saveCredential, {
        ownerId: owner,
        accessToken: tokenJson.access_token,
        refreshToken: tokenJson.refresh_token,
        expiresAt: Date.now() + tokenJson.expires_in * 1000,
        accountId: decodeAccountId(tokenJson.access_token),
      });
      logOAuth("info", "oauth.device.connected", { durationMs: Date.now() - startedAt });
      return { status: "connected" as const };
    } catch (error) {
      logOAuth("error", "oauth.device.poll_failed", {
        durationMs: Date.now() - startedAt,
        error: safeError(error),
      });
      throw error;
    }
  },
});

export const resolveAccessToken = action({
  args: { requestId: v.optional(v.string()) },
  handler: async (
    ctx,
    { requestId },
  ): Promise<{ accessToken: string; accountId: string } | null> => {
    const owner = await ownerId(ctx);
    const credential: StoredCredential | null = await ctx.runQuery(
      internal.openaiCodex.getCredential,
      { ownerId: owner },
    );
    if (!credential) {
      logOAuth("info", "oauth.credential.missing", { requestId });
      return null;
    }
    if (credential.expiresAt > Date.now() + 60_000) {
      return { accessToken: credential.accessToken, accountId: credential.accountId };
    }
    const startedAt = Date.now();
    logOAuth("info", "oauth.token.refresh_started", { requestId });
    try {
      const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: credential.refreshToken,
          client_id: CLIENT_ID,
        }),
      });
      const tokenJson = await readJson(response, "OpenAI token refresh");
      if (
        typeof tokenJson.access_token !== "string" ||
        typeof tokenJson.refresh_token !== "string" ||
        typeof tokenJson.expires_in !== "number"
      )
        throw new Error("OpenAI token refresh returned incomplete data");

      const accountId = decodeAccountId(tokenJson.access_token);
      await ctx.runMutation(internal.openaiCodex.saveCredential, {
        ownerId: owner,
        accessToken: tokenJson.access_token,
        refreshToken: tokenJson.refresh_token,
        expiresAt: Date.now() + tokenJson.expires_in * 1000,
        accountId,
      });
      logOAuth("info", "oauth.token.refreshed", {
        requestId,
        durationMs: Date.now() - startedAt,
      });
      return { accessToken: tokenJson.access_token, accountId };
    } catch (error) {
      logOAuth("error", "oauth.token.refresh_failed", {
        requestId,
        durationMs: Date.now() - startedAt,
        error: safeError(error),
      });
      throw error;
    }
  },
});

export const disconnect = mutation({
  args: {},
  handler: async (ctx) => {
    const owner = await ownerId(ctx);
    const credential = await ctx.db
      .query("openaiCodexCredentials")
      .withIndex("by_owner", (q) => q.eq("ownerId", owner))
      .unique();
    if (credential) await ctx.db.delete(credential._id);
    logOAuth("info", "oauth.disconnected", { credentialRemoved: Boolean(credential) });
  },
});

export const getCredential = internalQuery({
  args: { ownerId: v.string() },
  handler: (ctx, { ownerId }) =>
    ctx.db
      .query("openaiCodexCredentials")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .unique(),
});

export const saveCredential = internalMutation({
  args: {
    ownerId: v.string(),
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.number(),
    accountId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("openaiCodexCredentials")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .unique();
    const value = { ...args, updatedAt: Date.now() };
    if (existing) await ctx.db.replace(existing._id, value);
    else await ctx.db.insert("openaiCodexCredentials", value);
  },
});
