export interface OAuthCallbackResult {
  code: string | null;
  errorDescription: string | null;
}

export interface OAuthCallbackRouteParams {
  code?: string | string[];
  error?: string | string[];
  error_description?: string | string[];
}

function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function parseOAuthCallbackRouteParams(
  params: OAuthCallbackRouteParams,
): OAuthCallbackResult {
  return {
    code: firstValue(params.code),
    errorDescription:
      firstValue(params.error_description) ?? firstValue(params.error),
  };
}

export function parseOAuthCallbackUrl(
  callbackUrl: string,
): OAuthCallbackResult {
  const parsedUrl = new URL(callbackUrl);
  return {
    code: parsedUrl.searchParams.get("code"),
    errorDescription:
      parsedUrl.searchParams.get("error_description") ??
      parsedUrl.searchParams.get("error"),
  };
}
