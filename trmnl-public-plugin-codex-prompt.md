
# Codex Prompt — TRMNL Public Plugin Implementation (Vercel + Firebase)

## Goal
Implement the full server-side logic required for a **TRMNL Public Plugin** using:

- **Vercel Serverless Functions**
- **Firebase Firestore**
- **Firebase Auth**
- **Statuslanes backend**

The plugin must use **markup pull + OAuth** (NOT webhooks), because public plugins do not support webhook push.

Your job is to create the backend endpoints, token exchange logic, Firestore structure, and markup renderer so TRMNL devices can display the user’s status in near real-time.

---

## Architecture Requirements

### TRMNL → Vercel → Firestore → Statuslanes

1. TRMNL will call our Vercel API at installation time with an `installation_token`.
2. We must exchange that token with TRMNL’s OAuth endpoint to obtain:
   - `access_token`
   - `refresh_token`
   - `expires_in`
3. Store these tokens inside Firestore under:
   ```
   /trmnl/{plugin_setting_id}
   ```
4. The user will log into our management dashboard (Firebase Auth) and link their account to the TRMNL `plugin_setting_id`.
5. TRMNL devices will repeatedly GET our markup endpoint.
   This endpoint must:
   - Validate TRMNL's Bearer token
   - Resolve the plugin_setting_id
   - Load the linked Firebase user
   - Load the user’s current status from `/users/{uid}/status` in Firestore
   - Render TRMNL-compatible HTML markup
   - Respond with `text/html`
6. When TRMNL calls our uninstallation URL, we must delete the matching Firestore entry.

---

## Endpoints to Implement (All in `/api/...`)

### 1. `/api/trmnl/install`
Handles installation callback.

### Steps:
- Accept JSON with `installation_token` & `plugin_setting_id`.
- Exchange token at:
  ```
  POST https://api.usetrmnl.com/oauth/token
  {
    "installation_token": "...",
    "client_id": process.env.TRMNL_CLIENT_ID,
    "client_secret": process.env.TRMNL_CLIENT_SECRET,
    "grant_type": "installation_token"
  }
  ```
- Store returned tokens + expiry:
  ```
  /trmnl/{plugin_setting_id}
    access_token
    refresh_token
    expires_at
    linked_user_id
    config {}
  ```

---

### 2. `/api/trmnl/markup`
Called by TRMNL every refresh.

Steps:
1. Read `Authorization: Bearer <access_token>`
2. Validate token via TRMNL:
   ```
   GET https://api.usetrmnl.com/plugin-settings/me
   ```
3. Resolve `plugin_setting_id`
4. Load data from `/trmnl/{plugin_setting_id}`
5. Load user status from `/users/{linked_user_id}/status`
6. Render HTML markup:
   ```html
   <div class="layout layout--full layout--col layout--left h--full">
     <div class="p--6">
       <div class="text--left">
         <div class="value value--xlarge">${person_name}</div>
       </div>
       <div class="text--left mt--6 mb--1">
         <span class="value value--med">
           Currently, I am ${status_text}
         </span>
       </div>
     </div>
   </div>
   ```
7. Return `Content-Type: text/html`

---

### 3. `/api/trmnl/uninstall`
- Accept TRMNL uninstall webhook.
- Delete Firestore entry:
  ```
  /trmnl/{plugin_setting_id}
  ```

---

### 4. `/api/manage/link`
Used by the dashboard.

- Requires Firebase Auth.
- Accepts JSON `{ plugin_setting_id }`.
- Saves:
  ```
  /trmnl/{plugin_setting_id}.linked_user_id = current_user_uid
  ```

---

### 5. `/api/trmnl/refresh_oauth` (optional)
- Refresh tokens before expiry using TRMNL OAuth.

---

## Firestore Schema

```
/trmnl/{plugin_setting_id}
{
  access_token: string,
  refresh_token: string,
  expires_at: number,
  linked_user_id: string | null,
  config: {
    theme: string,
    refresh_preference: string
  }
}

/users/{uid}/status
{
  text: string,
  person_name: string,
  source: string,
  updated_at: number
}
```

---

## What Codex Should Produce
- Complete Vercel API route files for all endpoints
- Helper methods for:
  - Token exchange
  - Token refresh
  - TRMNL API validation
- Firestore wrappers
- Error handling
- Server-side HTML markup renderer
- TypeScript definitions

Requirements:
- Must use **TypeScript**
- Must use **Firebase Admin SDK**
- Must follow Vercel API route conventions
- Must not expose secrets

---

