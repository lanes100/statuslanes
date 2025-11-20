#!/usr/bin/env node

require("dotenv").config();

const BASE_URL = process.env.SYNC_BASE_URL;
const SYNC_SECRET = process.env.SYNC_SECRET;
const INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS ?? 15000);

if (!BASE_URL || !SYNC_SECRET) {
  console.error("calendar-heartbeat: SYNC_BASE_URL and SYNC_SECRET must be set in the environment.");
  process.exit(1);
}

async function tick() {
  try {
    const response = await fetch(`${BASE_URL.replace(/\/$/, "")}/api/calendar-cache/apply`, {
      method: "POST",
      headers: {
        "x-sync-secret": SYNC_SECRET,
      },
    });
    if (!response.ok) {
      const text = await response.text();
      console.error(`calendar-heartbeat: request failed (${response.status})`, text);
    } else {
      const payload = await response.json();
      console.log(
        `calendar-heartbeat: processed=${payload.processed ?? 0} changed=${payload.changed ?? 0} @ ${new Date().toISOString()}`,
      );
    }
  } catch (error) {
    console.error("calendar-heartbeat: request error", error);
  }
}

console.log(
  `calendar-heartbeat: starting heartbeat against ${BASE_URL}, interval=${INTERVAL_MS}ms (CTRL+C to exit)`,
);
tick();
setInterval(tick, INTERVAL_MS);
