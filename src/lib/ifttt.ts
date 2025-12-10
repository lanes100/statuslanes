import { randomBytes } from "crypto";

export function generateIftttId(): string {
  return randomBytes(16).toString("hex");
}

export function generateIftttSecret(): string {
  return randomBytes(32).toString("hex");
}
