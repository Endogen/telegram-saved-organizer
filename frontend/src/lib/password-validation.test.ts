import { describe, expect, it } from "vitest";

import {
  MAX_PASSWORD_BYTES,
  MIN_PASSWORD_BYTES,
  passwordByteLength,
  passwordPolicyError,
} from "@/lib/password-validation";

describe("password validation", () => {
  it("measures UTF-8 bytes rather than JavaScript code units", () => {
    expect("€€€€").toHaveLength(4);
    expect(passwordByteLength("€€€€")).toBe(MIN_PASSWORD_BYTES);
    expect(passwordPolicyError("€€€€")).toBeNull();
  });

  it("enforces the backend's inclusive 12 to 128 byte bounds", () => {
    expect(passwordPolicyError("a".repeat(MIN_PASSWORD_BYTES - 1))).toBe(
      "Password must contain at least 12 bytes.",
    );
    expect(passwordPolicyError("a".repeat(MIN_PASSWORD_BYTES))).toBeNull();
    expect(passwordPolicyError("a".repeat(MAX_PASSWORD_BYTES))).toBeNull();
    expect(passwordPolicyError("a".repeat(MAX_PASSWORD_BYTES + 1))).toBe(
      "Password must not exceed 128 bytes.",
    );
  });
});
