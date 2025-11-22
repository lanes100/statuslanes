import { adminDb } from "@/lib/firebaseAdmin";

const STATUS_DOC_ID = "current";

export type UserStatusRecord = {
  uid: string;
  text: string;
  personName: string;
  source: string;
  updatedAt: number;
  statusKey: number | null;
  statusLabel: string | null;
  deviceId: string | null;
  timezone: string | null;
};

export type SaveUserStatusInput = {
  uid: string;
  text?: string | null;
  personName?: string | null;
  fallbackName?: string | null;
  source?: string | null;
  statusKey?: number | null;
  statusLabel?: string | null;
  deviceId?: string | null;
  updatedAt?: number;
  timezone?: string | null;
};

export async function saveUserStatusRecord(input: SaveUserStatusInput): Promise<void> {
  if (!input.uid) return;
  const now = typeof input.updatedAt === "number" ? input.updatedAt : Date.now();
  const text = (input.text ?? "").trim() || "Updating…";
  const personNameRaw = input.personName ?? input.fallbackName ?? "Statuslanes user";
  const personName = personNameRaw?.trim() || "Statuslanes user";
  const source = (input.source ?? "Statuslanes").trim() || "Statuslanes";
  const statusKey = typeof input.statusKey === "number" ? input.statusKey : null;
  const statusLabel = input.statusLabel?.trim() || (statusKey ? text : null);
  const timezone = input.timezone?.trim() || null;
  const docRef = adminDb.collection("users").doc(input.uid).collection("status").doc(STATUS_DOC_ID);
  await docRef.set(
    {
      text,
      personName,
      source,
      updatedAt: now,
      statusKey,
      statusLabel,
      deviceId: input.deviceId ?? null,
      timezone,
    },
    { merge: true },
  );
}

export async function loadUserStatusRecord(uid: string): Promise<UserStatusRecord | null> {
  if (!uid) return null;
  const docRef = adminDb.collection("users").doc(uid).collection("status").doc(STATUS_DOC_ID);
  const snap = await docRef.get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  return {
    uid,
    text: typeof data.text === "string" ? data.text : "",
    personName: typeof data.personName === "string" ? data.personName : "Statuslanes user",
    source: typeof data.source === "string" ? data.source : "Statuslanes",
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
    statusKey: typeof data.statusKey === "number" ? data.statusKey : null,
    statusLabel: typeof data.statusLabel === "string" ? data.statusLabel : null,
    deviceId: typeof data.deviceId === "string" ? data.deviceId : null,
    timezone: typeof data.timezone === "string" ? data.timezone : null,
  };
}
