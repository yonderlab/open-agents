const TOKEN_REDACTION_PATTERNS: readonly RegExp[] = [
  /gh[pousr]_[A-Za-z0-9]+/g,
  /x-access-token:[^@\s"']+/g,
];

function redactTokens(message: string): string {
  let redacted = message;
  for (const pattern of TOKEN_REDACTION_PATTERNS) {
    redacted = redacted.replace(pattern, "[redacted]");
  }
  return redacted;
}

type SandboxSdkError = Error & {
  json?: { error?: { message?: string } };
};

export function sanitizeSandboxError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Unknown error creating sandbox";
  }

  const sdkJsonMessage = (error as SandboxSdkError).json?.error?.message;
  const combined = sdkJsonMessage
    ? `${sdkJsonMessage} (${error.message})`
    : error.message;

  return redactTokens(combined);
}
