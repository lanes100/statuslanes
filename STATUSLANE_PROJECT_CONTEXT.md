# STATUSLANE_PROJECT_CONTEXT.md

# **StatusLane — TRMNL Status Plugin + Web App**

*Comprehensive context for coding assistant*

---

## **1. Overview**

We are building:

### **A TRMNL custom plugin**

that displays a user’s status on their TRMNL device with a simple layout:

* **Person’s Name**
* **Currently I am {status_label}**
* Supports full, half-horizontal, half-vertical, and quadrant layouts
* Dynamic wrapping of long names
* 10 user-definable statuses
* User chooses status through:

  * TRMNL custom plugin panel
  * IFTTT automations
  * Future: A web app (primary interface)

### **A companion web app** (Next.js)

The web app will allow users to:

* Register their TRMNL plugin (via webhook URL)
* Fetch merge variables from TRMNL
* Display buttons for each status
* Clicking a button sends a webhook request to update TRMNL
* Store encrypted webhook URL
* Manage up to 10 statuses

---

## **2. Current plugin behavior**

The plugin supports:

* Person’s name
* Default status
* Show/hide “last updated”
* Show/hide “status source”
* Up to 10 status labels

Status updates from IFTTT use:

```
status_key: 1–10
```

The plugin resolves it like:

```liquid
{% assign status_label = status_{{status_key}}_label %}
```

The variable `updated_at` is handled manually by the web app or IFTTT.

---

## **3. TRMNL Developer Info**

From TRMNL developers:

### **Webhook usage**

You can fetch plugin merge variables using the SAME webhook URL:

```
GET https://usetrmnl.com/api/custom_plugins/<PLUGIN_ID>
```

This returns:

* merge_variables (all form field values)
* status_key
* status_label
* updated_at
* timestamp of last event
* device data

### **Polling URL templating**

You can inject variables into your polling URL:

```
https://example.com/api?fish={{fish}}&color={{color}}
```

This means:

* We *can* use polling if desired.
* But for this project, webhooks are preferred.

### **Webhooks vs Polling battery**

TRMNL devices don't poll the webhook themselves.
TRMNL servers do.
Battery is unaffected either way.

---

## **4. Form Fields (YAML)**

*(Already working in plugin)*

```yaml
- keyname: person_name
  field_type: string
  name: Person's Name
  default: Your Name
  optional: true

- keyname: default_status
  field_type: string
  name: Default Status (fallback)
  default: working hard 💻
  optional: true

- keyname: show_last_updated
  field_type: select
  name: Show Last Updated

[... omitted for brevity ...]
```

---

## **11. Recent Implementation Notes (Firebase auth + TRMNL integration)**

- Authentication via Firebase Auth with session cookies; `/login` handles sign in/up, `/api/login`/`/api/logout` manage cookies, `/api/session` checks auth.
- Firestore (via Firebase Admin) stores devices; middleware redirects unauthenticated users off protected routes.
- Device registration accepts TRMNL plugin ID (UUID), builds webhook URL, encrypts webhook with `WEBHOOK_SECRET_KEY`.
- APIs:
  - `POST /api/register-device` stores device (default ID `default`), pluginId, encrypted webhook, default statuses, show_last_updated on, show_status_source off, timezone/time/date formats; pushes initial labels/flags to TRMNL.
  - `GET /api/device` returns first device for user (or by id).
  - `PATCH /api/device` updates statuses (up to 12), flags, timezone/time/date formats; pushes labels/flags to TRMNL (keys 1–10).
  - `POST /api/set-status` sends `merge_variables` with status_text/status_source/show_last_updated/show_status_source/timezone/time_format/date_format/updated_at formatted per user; no reliance on status_key.
- Frontend:
  - Home shows auth state; status line “I am {status}”; selected button lighter; empty statuses hidden.
  - Device dashboard: inline edit statuses, add up to 12, delete per-row; “Save and close” toggle; silent fetch reduces flicker.
  - Settings: toggles show_last_updated/status_source, timezone/time/date formats, dark mode; auto-save on change (save button removed).
  - Login: dark mode; forgot password; `/reset-password` page verifies code and sets new password; middleware allows `/reset-password`.
  - PWA manifest/icons set for A2HS.
- Client UX: API fetch wrapper with light retry; Toast shelf; suppress error when no device yet.
- Ops: `.env.local` needs Firebase client/server creds + `WEBHOOK_SECRET_KEY`; set `NEXT_PUBLIC_APP_URL` for reset links; add domain to Firebase Auth.

## **Recent additions (Google auth + Calendar sync)**

- Google Sign-In on `/login` using Firebase `signInWithPopup` → `/api/login` session cookie.
- Google Calendar endpoints:
  - `/api/google-calendar/auth` (auth URL)
  - `/api/google-calendar/callback` (stores tokens per user in `google_tokens`)
  - `/api/google-calendar/status` (connected flag + lastSyncedAt)
  - `/api/google-calendar/calendars` (lists calendars)
  - `/api/google-calendar/sync` (per-user manual sync + TRMNL push)
  - `/api/google-calendar/sync-run` (bulk sync, secured by `x-sync-secret`, for schedulers)
  - `/api/google-calendar/sync-self` (per-user sync path)
  - `/api/google-calendar/disconnect`
- ICS syncing:
  - `/api/ics-sync-run` (bulk ICS sync; skipped if Google tokens exist; secured by `x-sync-secret`)
  - `/api/ics-sync-self` (per-user ICS sync)
  - Uses `ical.js` for parsing.
- Device schema fields:
  - `calendarIcsUrl`, `calendarIds` (selected Google calendars), `calendarKeywords`, `calendarKeywordStatusKey`, `calendarMeetingStatusKey`, `calendarOooStatusKey`, `calendarIdleStatusKey`, `calendarDetectVideoLinks` (treat video links as meetings).
- Calendar mapping logic:
  - Timed events → “Meetings map to”; all-day → “Out of office map to”; keyword matches → keyword mapping; optional video-link detection (Zoom/Teams/Meet/etc) treated as meeting if enabled; fallback to idle.
- Settings UI:
  - Auto-save; Google connect/disconnect; manual sync updates “Last synced”; calendar list with checkboxes.
  - ICS URL input; keyword filters (comma-separated, unlimited); keyword mapping selector; video-link detection toggle.
  - Subtext clarified to describe how mappings apply.
- Sync triggers:
  - GitHub Action (`.github/workflows/cron-sync.yml`) every 15 min hitting bulk sync endpoints. Requires repo secrets `SYNC_BASE_URL` (e.g., https://statuslanes.vercel.app) and `SYNC_SECRET`.
  - Sync endpoints require `x-sync-secret` if `SYNC_SECRET` set.
  - Heartbeat removed from dashboard; rely on scheduled GH workflow + manual sync button.
- TRMNL pushes: Google/ICS bulk and self sync push status to TRMNL when status changes.
- Env vars (prod/local):
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
  - `SYNC_SECRET` (matches GitHub secret)
  - Firebase envs (`WEBHOOK_SECRET_KEY`, Firebase creds, `NEXT_PUBLIC_APP_URL`, etc.)

## **Notes**
- GitHub Action uses repo secrets; Google secrets live only in Vercel/.env.local (do not commit).
- Cron on Vercel removed; scheduled sync via GitHub Action only.

## End of file
