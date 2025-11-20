# STATUSLANE_PROJECT_CONTEXT.md

# **StatusLanes — TRMNL Status Plugin + Web App**

Comprehensive context for coding assistant.

---

## 1. Overview
- TRMNL custom plugin shows a user’s status with name/status text; 10 statuses; show last updated/source; multiple layouts.
- Web app (Next.js) lets users register plugin via webhook, manage statuses, and push updates.

## 3. TRMNL Developer info
- Webhook: `https://usetrmnl.com/api/custom_plugins/<PLUGIN_ID>` returns merge variables, status, timestamps, device data.
- Polling templating supported but webhooks preferred; battery unaffected.

## 4. Form fields (YAML)
- Person name, default status, show_last_updated, show_status_source, up to 10 labels, timezone/time/date formats, etc. (see repository if needed).

## 11. Implementation notes (Firebase auth + TRMNL integration)
- Firebase Auth session cookies; `/login` handles sign in/up; `/api/login`/`/api/logout` manage cookies; `/api/session` checks auth.
- Firestore via Firebase Admin; devices stored per user; middleware redirects unauthenticated users.
- Device registration: accepts TRMNL plugin ID, builds/encrypts webhook (AES via `WEBHOOK_SECRET_KEY`), sets default statuses, show_last_updated on, show_status_source off, TZ/time/date formats, initial push to TRMNL.
- APIs:
  - `POST /api/register-device` (default device id `default`), stores pluginId/webhook/statuses/flags/timezone/time/date formats.
  - `GET /api/device` (first device or by id).
  - `PATCH /api/device` updates statuses/flags/timezone/time/date; pushes labels/flags to TRMNL (keys 1–10 only) if provided.
  - `POST /api/set-status` pushes status_text, status_source, show flags, timezone/time/date, formatted updated_at; updates Firestore.
- Frontend:
  - Home shows auth; status line “I am {status}”; selected button lighter; empty statuses hidden.
  - Device dashboard: inline edit statuses, add up to 12, delete per row; save & close toggle; silent fetch.
  - Settings page: toggles show_last_updated/source, timezone/time/date pickers; dark mode; auto-save (no save button).
  - Login: dark mode; forgot password; `/reset-password` page and middleware allow it.
  - PWA manifest/icons for A2HS.
- Client UX: API fetch wrapper with light retries; toast shelf; suppress error when device missing.
- Ops: `.env.local` needs Firebase client/server creds + `WEBHOOK_SECRET_KEY`; set `NEXT_PUBLIC_APP_URL` for reset links; add domain to Firebase Auth.

## Recent additions (Google auth + Calendar sync)
- Google Sign-In on `/login` (Firebase pop-up) → `/api/login` session cookie.
- Google Calendar endpoints:
  - `/api/google-calendar/auth` (auth URL), `/callback` (stores tokens in `google_tokens`), `/status` (connected + lastSyncedAt), `/calendars` (list), `/sync` (per-user manual sync + TRMNL push), `/sync-run` (bulk sync, secured by `x-sync-secret`), `/sync-self` (per-user sync), `/disconnect`.
- ICS syncing: `/api/ics-sync-run` (bulk, skipped if Google tokens exist, secured), `/api/ics-sync-self` (per-user); uses `ical.js`.
- Device schema fields: `calendarIcsUrl`, `calendarIds` (selected Google calendars), `calendarKeywords`, `calendarKeywordStatusKey`, `calendarMeetingStatusKey`, `calendarOooStatusKey`, `calendarIdleStatusKey`, `calendarDetectVideoLinks` (treat video links as meetings), `calendarVideoStatusKey` (separate mapping for video links).
- Calendar mapping logic: timed events → “Busy events map to” (meeting mapping), all-day → “All day events map to” (OOO mapping), keyword matches → keyword mapping, optional video-link detection (Zoom/Teams/Meet/Webex/etc) uses video mapping, fallback to idle mapping. Keyword filters are comma-separated, unlimited.
- Settings UI: auto-save; connect/disconnect Google; manual sync (immediate) updates last synced; calendar list checkboxes; ICS URL; keywords; keyword mapping; video-link detection toggle and mapping; labels updated to “Busy events map to”, “All day events map to”.
- Sync triggers: GitHub Action `.github/workflows/cron-sync.yml` every 15 min hitting `/api/google-calendar/sync-run` and `/api/ics-sync-run` secured by `x-sync-secret`. Requires repo secrets `SYNC_BASE_URL` (e.g., https://statuslanes.vercel.app) and `SYNC_SECRET`. Vercel cron removed. Heartbeat removed from dashboard; rely on Action + manual sync.
- TRMNL pushes: Google/ICS bulk and self sync push status to TRMNL when status changes.
- Env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `SYNC_SECRET`, Firebase creds, `WEBHOOK_SECRET_KEY`, `NEXT_PUBLIC_APP_URL`, etc. Google secrets only in Vercel/.env.local (not in GitHub).

## Notes
- GitHub secrets: `SYNC_BASE_URL`, `SYNC_SECRET` only. Google creds live in Vercel/env.local.
- Action has `workflow_dispatch` for manual run.
- Middleware deprecation warning in build; consider migrating to proxy later.

## Recent fixes and defaults
- TRMNL payloads trimmed to minimal keys (`status_text`, `status_source`, flags, `updated_at`) with `merge_strategy: "replace"` to avoid stale labels/time formats.
- Manual status sets seed `preferredStatus*` and clear `activeEventEndsAt`; sync flows use preferred/idle fallback and persist `activeEventEndsAt`.
- Calendar mapping defaults for new devices: video-link detection ON mapped to status key 2 (“in a meeting”), all-day -> key 5 (“out of office”), busy events -> do nothing, idle -> previous manual selection.
- Settings UI exposes “Previous manual selection” for idle, video mapping select, clearer labels; Google action buttons layout adjusted and light-gray styling.
- Calendar sync logic stores event end times and extends through back-to-back events with the same mapping (Google bulk/manual/self and ICS bulk/self) to avoid dropping status between consecutive meetings.
- `/about` (privacy policy) and `/terms` are public, linked in the menu and login/settings. Signup requires ticking Privacy + Terms checkboxes (works for Google signup too). About page has a back button; Terms page added.
- Status pushes: `/api/device` autosaves now resend the current status text/source/timestamp to keep TRMNL populated; sync endpoints store `activeStatusSource` (“Google Calendar”/“ICS”/“StatusLanes”) and only push on changes. Manual cron runs use cached events. Calendar window now only considers events starting within 5 minutes.

## Next action item
- Create/use a dedicated production Google OAuth Web client without loopback/localhost redirects to clear the “Use secure flows” warning. Add only prod origins/redirects, move localhost to a separate dev client, and point prod `GOOGLE_CLIENT_ID/SECRET` at the clean client.

## End of file
