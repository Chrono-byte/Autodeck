type LogLevel = "debug" | "info" | "warn" | "error";
type LogData = Record<string, unknown>;

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SECRET_KEYS =
  /^(authorization|accessToken|refreshToken|deviceAuthId|userCode|authorizationCode|codeVerifier|password|secret)$/i;

function configuredLevel(): LogLevel {
  const value = process.env.LOG_LEVEL?.toLowerCase();
  return value === "debug" || value === "warn" || value === "error" ? value : "info";
}

export function redactText(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]")
    .replace(/("(?:access|refresh)_token"\s*:\s*")[^"]+("?)/gi, "$1[REDACTED]$2");
}

export function sanitizeLogData(value: unknown, key = ""): unknown {
  if (SECRET_KEYS.test(key)) return "[REDACTED]";
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
      ...(value.stack && { stack: redactText(value.stack) }),
    };
  }
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeLogData(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        sanitizeLogData(child, childKey),
      ]),
    );
  }
  return value;
}

function write(level: LogLevel, event: string, data: LogData = {}) {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[configuredLevel()]) return;
  const line = JSON.stringify(
    sanitizeLogData({
      timestamp: new Date().toISOString(),
      level,
      service: "autodekt-web",
      event,
      ...data,
    }),
  );
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (level === "debug") console.debug(line);
  else console.info(line);
}

export const logger = {
  debug: (event: string, data?: LogData) => write("debug", event, data),
  info: (event: string, data?: LogData) => write("info", event, data),
  warn: (event: string, data?: LogData) => write("warn", event, data),
  error: (event: string, data?: LogData) => write("error", event, data),
};
