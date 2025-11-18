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
  options:
    - yes
    - no
  default: yes

- keyname: show_status_source
  field_type: select
  name: Show Status Source
  options:
    - yes
    - no
  default: no

- keyname: theme
  field_type: select
  name: Theme
  options:
    - default
    - large
    - minimal
    - bold
  default: default

# Status labels (1–10)
- keyname: status_1_label
  field_type: string
  name: Status 1 Label
  default: in the office 🏢
  optional: true

- keyname: status_2_label
  field_type: string
  name: Status 2 Label
  default: in a meeting 👥
  optional: true

- keyname: status_3_label
  field_type: string
  name: Status 3 Label
  default: working remotely 🏠
  optional: true

- keyname: status_4_label
  field_type: string
  name: Status 4 Label
  default: busy, do not disturb 🔕
  optional: true

- keyname: status_5_label
  field_type: string
  name: Status 5 Label
  default: out of the office 🌴
  optional: true

- keyname: status_6_label
  field_type: string
  name: Status 6 Label
  default: at lunch 🍽️
  optional: true

- keyname: status_7_label
  field_type: string
  name: Status 7 Label
  optional: true

- keyname: status_8_label
  field_type: string
  name: Status 8 Label
  optional: true

- keyname: status_9_label
  field_type: string
  name: Status 9 Label
  optional: true

- keyname: status_10_label
  field_type: string
  name: Status 10 Label
  optional: true
```

---

## **5. Rendering Layouts (final markup)**

All layouts now support proper line wrapping and dynamic spacing.

### FULLSCREEN

```html
<div class="layout layout--col layout--left"
     style="padding: 24px; display: flex; flex-direction: column; height: 100%;">

  <div class="text--left" style="margin-top: -10px;">
    <div class="value value--xlarge" style="white-space: normal; word-break: break-word;">
      {{ person_name | default: "Your Name" }}
    </div>
  </div>

  <div class="text--left" style="margin-top: 24px; margin-bottom: 4px;">
    <span class="value value--med">
      Currently I am {{ status_label | default: default_status }}
    </span>
  </div>
</div>
```

### HALF HORIZONTAL

```html
<div class="layout layout--col layout--left" style="padding: 24px;">

  <div class="text--left" style="margin-top: -10px;">
    <div class="value value--large" style="white-space: normal; word-break: break-word;">
      {{ person_name | default: "Your Name" }}
    </div>
  </div>

  <div class="text--left" style="margin-top: 8px;">
    <span class="value value--small">
      Currently I am {{ status_label | default: default_status }}
    </span>
  </div>
</div>
```

### HALF VERTICAL

```html
<div class="layout layout--col layout--left"
     style="padding: 24px; display: flex; flex-direction: column; height: 100%;">

  <div class="text--left" style="margin-top: -10px;">
    <div class="value value--large" style="white-space: normal; word-break: break-word;">
      {{ person_name | default: "Your Name" }}
    </div>
  </div>

  <div style="flex: 1 1 auto;"></div>

  <div class="text--left" style="margin-bottom: 4px;">
    <span class="value value--small">Currently I am</span>
  </div>

  <div class="text--left">
    <span class="value value--small" style="white-space: normal; word-break: break-word;">
      {{ status_label | default: default_status }}
    </span>
  </div>
</div>
```

### QUADRANT

```html
<div class="layout layout--col layout--left"
     style="padding: 24px; display: flex; flex-direction: column; height: 100%;">

  <div class="text--left">
    <div class="value value--med" style="white-space: normal; word-break: break-word;">
      {{ person_name | default: "Your Name" }}
    </div>
  </div>

  <div style="flex: 1 1 auto;"></div>

  <div class="text--left" style="margin-bottom: 4px;">
    <span class="value value--small">Currently I am</span>
  </div>

  <div class="text--left">
    <span class="value value--small" style="white-space: normal; word-break: break-word;">
      {{ status_label | default: default_status }}
    </span>
  </div>
</div>
```

---

## **6. “Last Updated” feature**

Optional via toggle.
Uses:

```
{% if trmnl.event.triggered_at %}
```

NOT `updated_at`.

---

## **7. Web App Architecture (accepted plan)**

### Tech stack:

* **Next.js (App Router)**
* **Tailwind CSS**
* **TypeScript**
* **Supabase (auth + DB + storage)**
* **AES-256 encryption for webhook URLs**
* **Vercel deployment**

### Why a web app?

* More flexible than IFTTT
* No IFTTT subscription limits
* Users can trigger status changes manually
* Can add automation features later
* Easier onboarding
* Can sync TRMNL fields dynamically

### Identity management:

* Using **Supabase Auth** (email/password or magic links)
* Each user can register multiple TRMNL devices
* Each device stores:

  * Person name
  * Default status
  * Status labels
  * Encrypted webhook URL
  * active_status_key
  * active_status_label
  * updated_at

---

## **8. Web App Required Features (MVP)**

### ✓ **1. Device onboarding screen**

User pastes TRMNL webhook URL → app fetches merge_variables → stores encrypted URL.

### ✓ **2. Device dashboard**

Shows up to 10 statuses.
Press button → sends webhook update → updates DB.

### ✓ **3. API Routes**

* `/api/register-device`
* `/api/set-status`
* `/api/device?id=<id>`

### ✓ **4. Encryption Layer**

AES-256-CBC
Stored in `webhook_url_encrypted`.

---

## **9. Next Steps for Implementation (hand this to Copilot)**

### **Backend:**

* [ ] Add Supabase Auth
* [ ] Add “sync TRMNL plugin” endpoint that refreshes labels from TRMNL
* [ ] Add database migrations (Supabase SQL)
* [ ] Add validation for plugin ID format
* [ ] Add ability to rename statuses in the web app

### **Frontend:**

* [ ] Build proper device dashboard UI
* [ ] Add loading skeletons
* [ ] Add full mobile-friendly design
* [ ] Add settings page to edit status names
* [ ] Add ability to reorder statuses
* [ ] Add option to disable individual statuses
* [ ] Add icons-as-SVG mode (future)

### **Security:**

* [ ] Ensure CORS locked
* [ ] Use secure cookies for auth
* [ ] Limit webhook retry behavior
* [ ] Add per-device API tokens

### **Deployment:**

* [ ] Deploy to Vercel
* [ ] Add environment variables
* [ ] Add Supabase project & keys
* [ ] Add production DB migrations
* [ ] Add rate limiting

---

## **10. Future Features (v2)**

* Location-based automations
* Calendar integration (ICS parser)
* Multi-user teams
* Presence history
* Home screen PWA
* Quick Actions Widget (iOS/Android)
* Button-based BLE puck (hardware add-on)

---

## **11. Recent Implementation Notes (Firebase auth + TRMNL integration)**

- Authentication is now via Firebase Auth with session cookies; `/login` page handles sign in/up, `/api/login`/`/api/logout` manage cookies, `/api/session` checks auth.
- Firestore (via Firebase Admin) stores devices; middleware redirects unauthenticated users off protected routes.
- Device registration accepts a TRMNL plugin ID (UUID) and builds the webhook URL internally; webhook URLs are encrypted at rest using `WEBHOOK_SECRET_KEY` (32-byte base64 in env).
- APIs:
  - `POST /api/register-device` stores device (default ID `default`), pluginId, encrypted webhook, default statuses, show_last_updated (on), show_status_source (off), timezone/time/date formats; pushes initial labels + flags to TRMNL.
  - `GET /api/device` returns the first device for the user (or by id).
  - `PATCH /api/device` updates statuses (up to 12), flags, timezone/time/date formats, and pushes labels + flags to TRMNL (keys 1–10).
  - `POST /api/set-status` now sends `merge_variables` with `status_text`, `status_source`, `show_last_updated`, `show_status_source`, `timezone`, `time_format`, `date_format`, `updated_at` formatted per user settings; no reliance on status_key.
- Frontend:
  - Home shows auth state; simplified layout; status line reads “I am {status}”; active buttons use lighter selected color; empty statuses hidden.
  - Device dashboard: edit statuses inline, add up to 12, delete per-row; “Save and close” toggles on the same button; silent fetch reduces flicker.
  - Settings panel: toggles for show_last_updated/on by default and show_status_source/off by default, timezone picker, time/date format selectors; full dark mode.
  - Login: full dark mode, forgot-password link sends reset email; new `/reset-password` page verifies oobCode and lets user set a new password; middleware allows `/reset-password`.
  - PWA manifest and icons (`public/icon-192.png`, `icon-512.png`) set for add-to-home-screen.
- Client UX improvements:
  - API fetch wrapper with light retry for 429/5xx and toast shelf with improved spacing; error suppressed when settings missing for unregistered device.
- Ops: `.env.local` requires Firebase client/server creds plus `WEBHOOK_SECRET_KEY`; set `NEXT_PUBLIC_APP_URL` to your deployed URL for reset links; add your domain to Firebase Auth Authorized domains. Icon assets live in `public/`.

## End of file
## End of file
