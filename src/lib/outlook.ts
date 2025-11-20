const AUTH_HOST = "https://login.microsoftonline.com";
const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

export type OutlookTokenResponse = {
  token_type: string;
  scope: string;
  expires_in: number;
  ext_expires_in?: number;
  access_token: string;
  refresh_token?: string;
};

export function getOutlookOAuthConfig() {
  const clientId = process.env.OUTLOOK_CLIENT_ID;
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;
  const redirectUri = process.env.OUTLOOK_REDIRECT_URI;
  const tenantId = process.env.OUTLOOK_TENANT_ID || "common";
  if (!clientId || !clientSecret || !redirectUri) {
    const missing = [
      !clientId ? "OUTLOOK_CLIENT_ID" : null,
      !clientSecret ? "OUTLOOK_CLIENT_SECRET" : null,
      !redirectUri ? "OUTLOOK_REDIRECT_URI" : null,
    ]
      .filter(Boolean)
      .join(", ");
    throw new Error(`Missing Outlook env vars: ${missing}`);
  }
  return { clientId, clientSecret, redirectUri, tenantId };
}

export function buildOutlookAuthUrl(state: string) {
  const { clientId, redirectUri, tenantId } = getOutlookOAuthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: "offline_access Calendars.Read",
    state,
    prompt: "consent",
  });
  return `${AUTH_HOST}/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
}

export async function exchangeOutlookCodeForToken(code: string): Promise<OutlookTokenResponse> {
  const cfg = getOutlookOAuthConfig();
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
  });
  const res = await fetch(`${AUTH_HOST}/${cfg.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to exchange Outlook code: ${res.status} ${body}`);
  }
  return (await res.json()) as OutlookTokenResponse;
}

export async function refreshOutlookToken(refreshToken: string): Promise<OutlookTokenResponse> {
  const cfg = getOutlookOAuthConfig();
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    redirect_uri: cfg.redirectUri,
  });
  const res = await fetch(`${AUTH_HOST}/${cfg.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to refresh Outlook token: ${res.status} ${body}`);
  }
  return (await res.json()) as OutlookTokenResponse;
}

export async function graphRequest<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GRAPH_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph request failed: ${res.status} ${body}`);
  }
  return (await res.json()) as T;
}
