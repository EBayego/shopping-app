export function parseOAuthCallbackUrl(callbackUrl: string): {
  code: string | null;
  errorDescription: string | null;
} {
  const parsedUrl = new URL(callbackUrl);
  return {
    code: parsedUrl.searchParams.get("code"),
    errorDescription:
      parsedUrl.searchParams.get("error_description") ??
      parsedUrl.searchParams.get("error"),
  };
}
