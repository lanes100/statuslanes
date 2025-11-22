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
      updatedAtText?: string | null;
      showLastUpdated?: boolean;
      showStatusSource?: boolean;
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
  if (options.variant === "ready") {
    return buildStatusLayouts({
      personName: options.personName,
      statusText: options.statusText,
      statusSource: options.statusSource ?? null,
      updatedAtText: options.updatedAtText ?? null,
      showLastUpdated: options.showLastUpdated,
      showStatusSource: options.showStatusSource,
    });
  }

  const baseName = options.personName?.trim() || "Statuslanes";
  let statusMessage = options.message?.trim();
  if (!statusMessage) {
    if (options.variant === "unlinked") {
      statusMessage = options.managementUrl
        ? `Connect this plugin at ${options.managementUrl}`
        : "Connect this plugin to Statuslanes to finish setup.";
    } else if (options.variant === "no-status") {
      statusMessage = "No recent status yet—set one in Statuslanes.";
    } else {
      statusMessage = "Status temporarily unavailable.";
    }
  }
  const source = options.managementUrl && options.variant !== "error" ? `Manage at ${options.managementUrl}` : null;

  return buildStatusLayouts({
    personName: baseName,
    statusText: statusMessage,
    statusSource: source,
    updatedAtText: null,
    showLastUpdated: false,
    showStatusSource: Boolean(source),
  });
}

type LayoutPayload = {
  personName: string;
  statusText: string;
  statusSource?: string | null;
  updatedAtText?: string | null;
  showLastUpdated?: boolean;
  showStatusSource?: boolean;
};

function buildStatusLayouts(data: LayoutPayload): TrmnlMarkupResponse {
  const personName = data.personName?.trim().length ? data.personName.trim() : "Statuslanes user";
  const statusText = data.statusText?.trim().length ? data.statusText.trim() : "Updating my status…";
  const personHtml = escapeHtml(personName);
  const statusHtml = applyEmojiWrapping(escapeHtml(statusText));
  const updatedHtmlRaw = data.updatedAtText?.trim() ?? "";
  const updatedHtml = updatedHtmlRaw ? escapeHtml(updatedHtmlRaw) : "";
  const sourceHtmlRaw = data.statusSource?.trim() ?? "";
  const sourceHtml = sourceHtmlRaw ? escapeHtml(sourceHtmlRaw) : "";
  const showUpdated = Boolean(data.showLastUpdated && updatedHtml);
  const showSource = Boolean(data.showStatusSource && sourceHtml);

  return {
    markup: buildFullLayout(personHtml, statusHtml, showUpdated, updatedHtml, showSource, sourceHtml),
    markup_half_horizontal: buildHalfHorizontalLayout(personHtml, statusHtml, showUpdated, updatedHtml, showSource, sourceHtml),
    markup_half_vertical: buildHalfVerticalLayout(personHtml, statusHtml, showUpdated, updatedHtml, showSource, sourceHtml),
    markup_quadrant: buildQuadrantLayout(personHtml, statusHtml, showUpdated, updatedHtml, showSource, sourceHtml),
    shared: SHARED_MARKUP,
  };
}

function buildFullLayout(
  personHtml: string,
  statusHtml: string,
  showUpdated: boolean,
  updatedHtml: string,
  showSource: boolean,
  sourceHtml: string,
): string {
  return `
<!-- MAIN CONTENT AREA -->
<div class="layout layout--full layout--col layout--left h--full">
  <div class="p--6">

    <!-- Person Name -->
    <div class="text--left">
      <div class="value value--xlarge" style="white-space: normal; word-break: break-word;">
        ${personHtml}
      </div>
    </div>

    <!-- Status -->
    <div class="text--left mt--6">
      <span class="value value--med" style="white-space: normal; word-break: break-word;">
        Currently, I am ${statusHtml}
      </span>
    </div>

  </div>
</div>

${buildPrimaryFooter(showUpdated, updatedHtml, showSource, sourceHtml)}
  `.trim();
}

function buildHalfHorizontalLayout(
  personHtml: string,
  statusHtml: string,
  showUpdated: boolean,
  updatedHtml: string,
  showSource: boolean,
  sourceHtml: string,
): string {
  return `
<div class="layout layout--full layout--col layout--left h--full p--6">

  <!-- Person Name -->
  <div class="text--left">
    <div class="value value--large" style="white-space: normal; word-break: break-word;">
      ${personHtml}
    </div>
  </div>

  <!-- Status -->
  <div class="text--left mt--6">
    <span class="value value--small" style="white-space: normal; word-break: break-word;">
      Currently, I am ${statusHtml}
    </span>
  </div>

</div>

${buildPrimaryFooter(showUpdated, updatedHtml, showSource, sourceHtml)}
  `.trim();
}

function buildHalfVerticalLayout(
  personHtml: string,
  statusHtml: string,
  showUpdated: boolean,
  updatedHtml: string,
  showSource: boolean,
  sourceHtml: string,
): string {
  return `
<div class="layout layout--full layout--col layout--left h--full p--6">

  <!-- Person Name -->
  <div class="text--left mt--1">
    <div class="value value--large" style="white-space: normal; word-break: break-word;">
      ${personHtml}
    </div>
  </div>

  <!-- Spacer to push status toward bottom -->
  <div class="grow"></div>

  <!-- "Currently, I am" -->
  <div class="text--left mt--1">
    <span class="value value--small">
      Currently, I am
    </span>
  </div>

  <!-- Status -->
  <div class="text--left mt--0">
    <span class="value value--small" style="white-space: normal; word-break: break-word;">
      ${statusHtml}
    </span>
  </div>

</div>

${buildSecondaryFooter(showUpdated, updatedHtml, showSource, sourceHtml)}
  `.trim();
}

function buildQuadrantLayout(
  personHtml: string,
  statusHtml: string,
  showUpdated: boolean,
  updatedHtml: string,
  showSource: boolean,
  sourceHtml: string,
): string {
  return `
<div class="layout layout--full layout--col layout--left h--full p--6">

  <!-- Name -->
  <div class="text--left mt--1">
    <div class="value value--med" style="white-space: normal; word-break: break-word;">
      ${personHtml}
    </div>
  </div>

  <!-- Spacer -->
  <div class="grow"></div>

  <!-- "Currently I am" -->
  <div class="text--left mt--1">
    <span class="value value--small">
      Currently, I am
    </span>
  </div>

  <!-- Status Label -->
  <div class="text--left mt--0">
    <span class="value value--small" style="white-space: normal; word-break: break-word;">
      ${statusHtml}
    </span>
  </div>

</div>

${buildSecondaryFooter(showUpdated, updatedHtml, showSource, sourceHtml)}
  `.trim();
}

function buildPrimaryFooter(showUpdated: boolean, updatedHtml: string, showSource: boolean, sourceHtml: string): string {
  const updated = showUpdated ? `Updated ${updatedHtml}` : "";
  const separator = showUpdated && showSource ? " &middot; " : "";
  const source = showSource ? sourceHtml : "";
  return `
<!-- TITLE BAR FOOTER -->
<div class="title_bar">
  <span class="title">My Status</span>

  <span class="instance">
    ${updated}${separator}${source}
  </span>
</div>
  `.trim();
}

function buildSecondaryFooter(showUpdated: boolean, updatedHtml: string, showSource: boolean, sourceHtml: string): string {
  const updated = showUpdated ? `Updated ${updatedHtml}` : "";
  const source = showSource ? sourceHtml : "";
  return `
<!-- FOOTER BAR (TRMNL-standard) -->
<div class="title_bar">
  <span class="title">
    ${updated}
  </span>

  <span class="instance">
    ${source}
  </span>
</div>
  `.trim();
}

const SHARED_MARKUP = `
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Emoji:wght@300&display=swap" rel="stylesheet">

<style>
  .emoji {
    font-family: "Noto Emoji", sans-serif;
    font-weight: 300;
  }
</style>
`.trim();

const RAW_EMOJI_LIST = `
🏢,🏠,👥,🔕,🌴,🍽,
💼,📅,📁,📂,🗂️,📝,📌,⏳,⌛,
📞,📣,📧,📡,💬,📨,📤,📥,
⭐,✨,⚡,🔥,🚨,🛑,⚠️,🔔,🔕,🎯,📍,🧭,
🕐,🕑,🕒,🕓,🕔,🕕,🕖,🕗,🕘,🕙,🕚,🕛,
⏰,⏱️,⏲️,🗓️,
😀,😃,😄,😁,😆,😅,🤣,😂,🙂,🙃,😉,😊,😇,
😐,😑,😶,🙄,😮,😯,😲,😴,🥱,😪,😵,🤯,
😎,😕,😞,😔,😣,😩,😫,😤,😡,😠,😢,😭,
🥰,😍,🤩,😏,😌,🥹,
💻,🖥️,⌨️,🖱️,🗄️,📊,📈,📉,🧩,🛠️,🧰,🔧,⚙️,
✈️,🛫,🛬,🚗,🚕,🚙,🚆,🚉,🚌,🚇,🛣️,
🌍,🌎,🌏,📍,
🍽,🍱,🍔,🍕,🍜,🍲,☕,🍵,🥤,🧃,
🌤️,⛅,☁️,🌧️,🌦️,❄️,🌩️,🌪️,🌈,🌞,🌙,⭐,
✔️,❌,➕,➖,➡️,⬅️,🔄,🔁,♻️,💡,🔒,🔓,
🤒,🤕,🤢,🤮,🤧,
😷,😴,😪,😵,😞,😩,😫,
🛌,💤,😌,
💊,🩹,🩺,🩼,🧪,🧫,
🏥,🚑,
😔,😟,😕,😣,😖
`;

const EMOJI_LIST = RAW_EMOJI_LIST.split(",").map((item) => item.trim()).filter((item) => item.length > 0);

function applyEmojiWrapping(html: string): string {
  let output = html;
  for (const emoji of EMOJI_LIST) {
    output = output.split(emoji).join(`<span class="emoji">${emoji}</span>`);
  }
  return output;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
