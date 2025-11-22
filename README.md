# Statuslanes

Statuslanes is a Next.js (App Router) dashboard that keeps TRMNL devices in sync with a user’s current status. It supports manual status updates, Google/Outlook/ICS calendar automations, and now the full public TRMNL Marketplace flow (OAuth install → plugin management → markup generation → uninstall).

## Getting started

1. Install dependencies and run the dev server:

   ```bash
   npm install
   npm run dev
   ```

2. Copy `.env.example` to `.env.local` and provide the required keys:

   - Firebase Admin + Web SDK values
   - `WEBHOOK_SECRET_KEY` for encrypting custom-plugin webhooks
   - Google + Outlook OAuth credentials
   - `SYNC_SECRET` for internal cron/webhook authentication
   - TRMNL Marketplace OAuth credentials:
     - `TRMNL_CLIENT_ID`
     - `TRMNL_CLIENT_SECRET`
     - `TRMNL_API_BASE` (optional, defaults to `https://api.usetrmnl.com`)

3. `NEXT_PUBLIC_APP_URL` (if set) is used in TRMNL markup responses to show a “Manage at …/settings” hint.

## TRMNL public plugin flow

The new `/api/trmnl/*` endpoints implement the official installation/management/screen-generation flow from the TRMNL documentation:

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/trmnl/install` | `POST` | Receives `installation_token` + `plugin_setting_id`, exchanges the token with TRMNL OAuth, and stores the resulting access/refresh tokens at `trmnl/{plugin_setting_id}`. |
| `/api/manage/link` | `POST` (auth required) | Links the authenticated Firebase user to a TRMNL installation by saving `linkedUserId` inside `trmnl/{plugin_setting_id}`. |
| `/api/trmnl/markup` | `POST` | Validates the Bearer token with `plugin-settings/me`, looks up the linked Firebase user, loads their persisted status from `/users/{uid}/status`, and returns the TRMNL markup variants. |
| `/api/trmnl/uninstall` | `POST` | Deletes the stored installation document when TRMNL sends the uninstall webhook (Authorization token is revalidated when provided). |
| `/api/trmnl/refresh_oauth` | `POST` | (Cron/secure webhook) Refreshes access tokens that are about to expire; requires `x-sync-secret` when `SYNC_SECRET` is set. |

### User status persistence

Every status change (manual, Google Calendar, Outlook, ICS, cached heartbeat) now writes to `/users/{uid}/status/current` with `{ text, personName, source, statusKey, statusLabel, deviceId, timezone, updatedAt }`. The markup endpoint renders straight from this document so TRMNL pull-based devices always see the most recent status even if webhook pushes temporarily fail.

### Firestore layout (relevant collections)

```
/devices/{deviceId}
/google_tokens/{uid}
/outlook_tokens/{uid}
/trmnl/{plugin_setting_id}
/users/{uid}/status/current
```

## Development tips

- Use `npm run lint` before committing; some legacy warnings exist, but no new errors should be introduced.
- Protected cron-style endpoints (`/api/google-calendar/sync-run`, `/api/ics-sync-run`, `/api/trmnl/refresh_oauth`, etc.) require `x-sync-secret` when `SYNC_SECRET` is configured.
- The shared helpers in `src/lib/trmnl.ts` and `src/lib/userStatus.ts` centralize OAuth, markup rendering, and status persistence—import them instead of duplicating logic when extending the plugin flow.
