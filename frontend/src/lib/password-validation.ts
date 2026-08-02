export const MIN_PASSWORD_BYTES = 12;
export const MAX_PASSWORD_BYTES = 128;

export const PASSWORD_POLICY_HELP =
  "Use 12–128 UTF-8 bytes. Emoji and some non-Latin characters use more than one byte.";

const encoder = new TextEncoder();

export function passwordByteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

export function passwordPolicyError(value: string): string | null {
  const byteLength = passwordByteLength(value);
  if (byteLength < MIN_PASSWORD_BYTES) {
    return `Password must contain at least ${MIN_PASSWORD_BYTES} bytes.`;
  }
  if (byteLength > MAX_PASSWORD_BYTES) {
    return `Password must not exceed ${MAX_PASSWORD_BYTES} bytes.`;
  }
  return null;
}
