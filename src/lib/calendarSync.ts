import { decrypt } from "@/lib/crypto";
import { scheduleCalendarCacheApply } from "@/lib/calendarHeartbeat";

export type CachedEvent = { start: number; end: number; statusKey: number | null };

export type DeviceRecord = {
  deviceId: string;
  userId: string;
  calendarIds?: string[];
  outlookCalendarIds?: string[];
  calendarIcsUrl?: string | null;
  calendarKeywords?: string[];
  calendarKeywordStatusKey?: number | null;
  calendarMeetingStatusKey?: number | null;
  calendarOooStatusKey?: number | null;
  calendarIdleStatusKey?: number | null;
  statuses?: { key: number; label: string; enabled: boolean }[];
  activeStatusKey?: number | null;
  activeStatusLabel?: string | null;
  preferredStatusKey?: number | null;
  preferredStatusLabel?: string | null;
  activeStatusSource?: string | null;
  calendarIdleUsePreferred?: boolean;
  calendarDetectVideoLinks?: boolean;
  calendarVideoStatusKey?: number | null;
  calendarCachedEvents?: CachedEvent[];
  activeEventEndsAt?: number | null;
  timezone?: string;
  dateFormat?: string;
  timeFormat?: string;
  showLastUpdated?: boolean;
  showStatusSource?: boolean;
  webhookUrlEncrypted?: string;
};

export type NormalizedCalendarEvent = {
  start: number;
  end: number;
  title: string;
  description: string;
  location?: string;
  isAllDay: boolean;
  hasVideoLink?: boolean;
};

const VIDEO_LINK_RE =
  /(zoom\.us|teams\.microsoft\.com|meet\.google\.com|webex\.com|gotomeeting\.com|bluejeans\.com|ringcentral\.com|whereby\.com|join\.skype\.com|chime\.aws|hopin\.com|join\.me)/i;

export function mapEventsForCache(events: NormalizedCalendarEvent[], device: DeviceRecord): CachedEvent[] {
  const keywordList = (device.calendarKeywords ?? []).map((s) => s.toLowerCase());
  const matchKeyword =
    device.calendarKeywordStatusKey && keywordList.length > 0
      ? (title: string, desc: string) => {
          const hay = `${title} ${desc}`.toLowerCase();
          return keywordList.some((k) => hay.includes(k));
        }
      : () => false;

  return events.map((ev) => {
    let key: number | null = null;
    const hasVideo =
      typeof ev.hasVideoLink === "boolean"
        ? ev.hasVideoLink
        : Boolean(device.calendarDetectVideoLinks) &&
          (VIDEO_LINK_RE.test(ev.location ?? "") || VIDEO_LINK_RE.test(ev.description ?? ""));
    if (matchKeyword(ev.title ?? "", ev.description ?? "")) key = device.calendarKeywordStatusKey ?? null;
    else if (hasVideo && device.calendarVideoStatusKey) key = device.calendarVideoStatusKey;
    else if (ev.isAllDay && device.calendarOooStatusKey) key = device.calendarOooStatusKey;
    else if (!ev.isAllDay && device.calendarMeetingStatusKey) key = device.calendarMeetingStatusKey;
    else if (device.calendarIdleUsePreferred && device.preferredStatusKey) key = device.preferredStatusKey;
    else if (device.calendarIdleStatusKey) key = device.calendarIdleStatusKey;
    return { start: ev.start, end: ev.end, statusKey: key };
  });
}

export function buildSameDayCache(events: CachedEvent[], now: number): CachedEvent[] {
  const startOfDay = new Date(now).setHours(0, 0, 0, 0);
  const endOfDay = new Date(now).setHours(23, 59, 59, 999);
  return events
    .filter((e) => e.end >= startOfDay && e.start <= endOfDay && e.end >= now)
    .sort((a, b) => a.start - b.start)
    .slice(0, 10);
}

export async function applyCachedEvents(
  device: DeviceRecord,
  deviceRef: FirebaseFirestore.DocumentReference,
  now: number,
  sourceLabel: string,
) {
  const resolveFallback = () => {
    const fallbackKeyCandidate =
      (device.calendarIdleUsePreferred && device.preferredStatusKey) ||
      (!device.calendarIdleUsePreferred && device.calendarIdleStatusKey)
        ? device.calendarIdleUsePreferred
          ? device.preferredStatusKey
          : device.calendarIdleStatusKey
        : device.preferredStatusKey || device.calendarIdleStatusKey || null;
    if (!fallbackKeyCandidate) return null;
    const fallbackLabel =
      device.statuses?.find((s) => s.key === fallbackKeyCandidate)?.label ??
      (fallbackKeyCandidate === device.preferredStatusKey ? device.preferredStatusLabel ?? null : null);
    return { key: fallbackKeyCandidate, label: fallbackLabel };
  };

  const cached = (device.calendarCachedEvents ?? []).filter((e) => e.end > now);
  if (cached.length === 0) {
    const hadEvents = (device.calendarCachedEvents?.length ?? 0) > 0;
    if (hadEvents) {
      await deviceRef.update({ calendarCachedEvents: [] });
      device.calendarCachedEvents = [];
    }
    const fallback = resolveFallback();
    if (device.activeEventEndsAt && device.activeEventEndsAt <= now && fallback) {
      device.activeStatusKey = fallback.key ?? null;
      device.activeStatusLabel = fallback.label ?? null;
      device.activeStatusSource = sourceLabel;
      device.activeEventEndsAt = null;
      await deviceRef.update({
        activeStatusKey: fallback.key,
        activeStatusLabel: fallback.label ?? null,
        activeStatusSource: sourceLabel,
        activeEventEndsAt: null,
        updatedAt: now,
      });
      await pushStatusToTrmnl(device, fallback.key, fallback.label ?? "", sourceLabel);
      return true;
    }
    if (device.activeEventEndsAt && device.activeEventEndsAt <= now) {
      device.activeEventEndsAt = null;
      await deviceRef.update({ activeEventEndsAt: null });
    }
    return false;
  }
  cached.sort((a, b) => a.start - b.start);
  let chosen: CachedEvent | null = null;
  for (const ev of cached) {
    if (now >= ev.start && now <= ev.end) {
      if (!chosen || ev.end > chosen.end) {
        chosen = ev;
      }
    }
  }
  if (!chosen) {
    await deviceRef.update({ calendarCachedEvents: cached });
    device.calendarCachedEvents = cached;
    const fallback = resolveFallback();
    if (fallback) {
      const needsUpdate =
        device.activeStatusKey !== fallback.key ||
        device.activeStatusLabel !== fallback.label ||
        device.activeEventEndsAt !== null;
      if (needsUpdate) {
        device.activeStatusKey = fallback.key ?? null;
        device.activeStatusLabel = fallback.label ?? null;
        device.activeStatusSource = sourceLabel;
        device.activeEventEndsAt = null;
        await deviceRef.update({
          activeStatusKey: fallback.key,
          activeStatusLabel: fallback.label ?? null,
          activeStatusSource: sourceLabel,
          activeEventEndsAt: null,
          updatedAt: now,
          calendarCachedEvents: cached,
        });
        await pushStatusToTrmnl(device, fallback.key, fallback.label ?? "", sourceLabel);
        return true;
      }
    } else if (device.activeEventEndsAt && device.activeEventEndsAt <= now) {
      await deviceRef.update({ activeEventEndsAt: null, calendarCachedEvents: cached });
      device.activeEventEndsAt = null;
    }
    const upcoming = cached.find((ev) => ev.start > now);
    if (upcoming) {
      await scheduleCalendarCacheApply(device.deviceId, upcoming.start);
    }
    return false;
  }
  const label =
    device.statuses?.find((s) => s.key === chosen.statusKey)?.label ??
    (chosen.statusKey === device.preferredStatusKey ? device.preferredStatusLabel ?? null : null);
  if (device.activeStatusKey !== chosen.statusKey || device.activeStatusLabel !== label) {
    device.activeStatusKey = chosen.statusKey;
    device.activeStatusLabel = label ?? null;
    device.activeStatusSource = sourceLabel;
    device.activeEventEndsAt = chosen.end;
    device.calendarCachedEvents = cached;
    await deviceRef.update({
      activeStatusKey: chosen.statusKey,
      activeStatusLabel: label ?? null,
      activeStatusSource: sourceLabel,
      activeEventEndsAt: chosen.end,
      calendarCachedEvents: cached,
      updatedAt: now,
    });
    await pushStatusToTrmnl(device, chosen.statusKey, label ?? "", sourceLabel);
    await scheduleCalendarCacheApply(device.deviceId, chosen.end);
    const nextEvent = cached.find((ev) => ev.start > now && ev.start > chosen.end);
    if (nextEvent) {
      await scheduleCalendarCacheApply(device.deviceId, nextEvent.start);
    }
    return true;
  }
  await deviceRef.update({ calendarCachedEvents: cached });
  device.calendarCachedEvents = cached;
  const nextUpcoming = cached.find((ev) => ev.start > now);
  if (nextUpcoming) {
    await scheduleCalendarCacheApply(device.deviceId, nextUpcoming.start);
  }
  return false;
}

export async function pushStatusToTrmnl(
  device: DeviceRecord,
  statusKey: number | null,
  statusLabel: string,
  sourceOverride?: string,
) {
  if (!statusKey || !device.webhookUrlEncrypted) return;
  const webhookUrl = decrypt(device.webhookUrlEncrypted);
  if (!webhookUrl) return;
  const status = statusLabel || device.statuses?.find((s) => s.key === statusKey)?.label || "";
  const timezone = device.timezone ?? "UTC";
  const dateFormat = device.dateFormat ?? "MDY";
  const timeFormat = device.timeFormat ?? "24h";
  const formattedUpdatedAt = formatTimestamp(Date.now(), timezone, dateFormat, timeFormat);
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merge_variables: {
          status_text: status,
          show_last_updated: device.showLastUpdated ?? true,
          show_status_source: device.showStatusSource ?? false,
          status_source: sourceOverride ?? device.activeStatusSource ?? "Calendar",
          updated_at: formattedUpdatedAt,
        },
        merge_strategy: "replace",
      }),
    });
  } catch (err) {
    console.error("pushStatusToTrmnl failed", err);
  }
}

export function formatTimestamp(timestamp: number, timezone: string, dateFormat: string, timeFormat: string): string {
  const date = new Date(timestamp);
  const hour12 = timeFormat !== "24h";

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12,
  }).formatToParts(date);

  const lookup: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") lookup[p.type] = p.value;
  }

  const yyyy = lookup.year;
  const mm = lookup.month;
  const dd = lookup.day;

  const dateStr =
    dateFormat === "DMY" ? `${dd}/${mm}/${yyyy}` : dateFormat === "YMD" ? `${yyyy}-${mm}-${dd}` : `${mm}/${dd}/${yyyy}`;

  const timeStr = `${lookup.hour ?? ""}:${lookup.minute ?? ""}${hour12 && lookup.dayPeriod ? " " + lookup.dayPeriod : ""}`;

  return `${dateStr} ${timeStr}`.trim();
}
