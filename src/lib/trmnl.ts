const DEFAULT_TRMNL_API_BASE = "https://api.usetrmnl.com";

export type TrmnlTokenResponse = {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
};

export type PluginSettingsInfo = {
  pluginSettingId: string;
  raw: Record<string, unknown>;
};

export type RenderStatusMarkupOptions =
  | {
      variant: "ready";
      personName: string;
      statusText: string;
      statusSource?: string | null;
      updatedAt?: number | null;
      timezone?: string | null;
      managementUrl?: string | null;
    }
  | {
      variant: "no-status" | "unlinked" | "error";
      personName?: string | null;
      message?: string | null;
      managementUrl?: string | null;
    };

export type TrmnlMarkupResponse = {
  markup: string;
  markup_half_horizontal: string;
  markup_half_vertical: string;
  markup_quadrant: string;
  shared: string;
};

function getTrmnlApiBase(): string {
  const base = process.env.TRMNL_API_BASE?.trim() || DEFAULT_TRMNL_API_BASE;
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

export async function exchangeInstallationToken(installationToken: string): Promise<TrmnlTokenResponse> {
  return requestToken({
    installation_token: installationToken,
    client_id: getRequiredEnv("TRMNL_CLIENT_ID"),
    client_secret: getRequiredEnv("TRMNL_CLIENT_SECRET"),
    grant_type: "installation_token",
  });
}

export async function refreshTrmnlAccessToken(refreshToken: string): Promise<TrmnlTokenResponse> {
  return requestToken({
    refresh_token: refreshToken,
    client_id: getRequiredEnv("TRMNL_CLIENT_ID"),
    client_secret: getRequiredEnv("TRMNL_CLIENT_SECRET"),
    grant_type: "refresh_token",
  });
}

async function requestToken(body: Record<string, string>): Promise<TrmnlTokenResponse> {
  const res = await fetch(`${getTrmnlApiBase()}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TRMNL token request failed (${res.status}): ${text || "no body"}`);
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const accessToken = typeof json.access_token === "string" ? json.access_token : null;
  if (!accessToken) throw new Error("TRMNL token response missing access_token");
  return {
    accessToken,
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : undefined,
    expiresIn: typeof json.expires_in === "number" ? json.expires_in : undefined,
    tokenType: typeof json.token_type === "string" ? json.token_type : undefined,
  };
}

export async function fetchPluginSettings(accessToken: string): Promise<PluginSettingsInfo> {
  const res = await fetch(`${getTrmnlApiBase()}/plugin-settings/me`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TRMNL plugin-settings request failed (${res.status}): ${text || "no body"}`);
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const pluginSettingId = extractPluginSettingId(json);
  if (!pluginSettingId) {
    throw new Error("TRMNL response missing plugin_setting_id");
  }
  return { pluginSettingId, raw: json };
}

function extractPluginSettingId(json: Record<string, unknown>): string | null {
  if (!json) return null;
  const direct = json.plugin_setting_id;
  if (typeof direct === "string" || typeof direct === "number") {
    return String(direct);
  }
  const nested = (json.plugin_setting as Record<string, unknown>)?.id;
  if (typeof nested === "string" || typeof nested === "number") {
    return String(nested);
  }
  const plugin = json.plugin_setting as Record<string, unknown> | undefined;
  if (plugin) {
    const uuid = plugin.uuid;
    if (typeof uuid === "string") return uuid;
  }
  return null;
}

function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var ${key}`);
  return value;
}

export function renderStatusMarkup(options: RenderStatusMarkupOptions): TrmnlMarkupResponse {
  let heading = "Statuslanes";
  let body = "Connecting…";
  let meta = "";
  if (options.variant === "ready") {
    heading = options.personName;
    body = `Currently, I am ${escapeHtml(options.statusText)}`;
    const parts: string[] = [];
    if (options.statusSource) parts.push(`Source: ${escapeHtml(options.statusSource)}`);
    if (options.updatedAt) {
      parts.push(`Updated ${formatTimestamp(options.updatedAt, options.timezone ?? "UTC")}`);
    }
    meta = parts.join(" • ");
  } else if (options.variant === "no-status") {
    heading = options.personName?.trim() || "Statuslanes";
    body = "No status yet";
    meta = "Update your status in the Statuslanes dashboard.";
  } else if (options.variant === "unlinked") {
    heading = "Connect Statuslanes";
    body = "Visit the Statuslanes dashboard to link this TRMNL plugin.";
    meta = options.managementUrl ? `Open ${escapeHtml(options.managementUrl)} to finish setup.` : "";
  } else if (options.variant === "error") {
    heading = "Status unavailable";
    body = options.message?.trim() || "We ran into a temporary error.";
  }
  if (!meta && options.managementUrl && options.variant !== "ready") {
    meta = `Manage at ${escapeHtml(options.managementUrl)}`;
  }
  const markup = buildMarkup("view--full", heading, body, meta);
  return {
    markup,
    markup_half_horizontal: buildMarkup("view--half_horizontal", heading, body, meta),
    markup_half_vertical: buildMarkup("view--half_vertical", heading, body, meta),
    markup_quadrant: buildMarkup("view--quadrant", heading, body, meta),
    shared: "",
  };
}

function buildMarkup(viewClass: string, heading: string, body: string, meta?: string): string {
  const metaBlock = meta ? `<div class="text--xs text--muted mt--4">${escapeHtml(meta)}</div>` : "";
  return `
<div class="view ${viewClass}">
  <div class="layout layout--full layout--col layout--left h--full">
    <div class="p--6">
      <div class="text--left">
        <div class="value value--xlarge">${escapeHtml(heading)}</div>
      </div>
      <div class="text--left mt--6 mb--1">
        <span class="value value--med">${body}</span>
      </div>
      ${metaBlock}
    </div>
  </div>
</div>`.trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTimestamp(timestamp: number, timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    return formatter.format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toISOString();
  }
}
