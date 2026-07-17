import { describe, expect, it } from "vitest";
import { redactText, sanitizeLogData } from "./logger.server";

describe("server logger redaction", () => {
  it("redacts nested credential fields", () => {
    expect(
      sanitizeLogData({
        accessToken: "access-secret",
        nested: { refreshToken: "refresh-secret", safe: "visible" },
      }),
    ).toEqual({
      accessToken: "[REDACTED]",
      nested: { refreshToken: "[REDACTED]", safe: "visible" },
    });
  });

  it("redacts bearer credentials, JWTs, and serialized token values", () => {
    const text =
      'Bearer abc.def.ghi eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature {"access_token":"secret"}';
    const redacted = redactText(text);

    expect(redacted).not.toContain("abc.def.ghi");
    expect(redacted).not.toContain("eyJhbGci");
    expect(redacted).not.toContain('"secret"');
  });

  it("sanitizes error messages and stacks", () => {
    const sanitized = sanitizeLogData(new Error("Bearer token-value")) as {
      message: string;
      stack?: string;
    };

    expect(sanitized.message).toBe("Bearer [REDACTED]");
    expect(sanitized.stack).not.toContain("token-value");
  });
});
