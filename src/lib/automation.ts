import { randomBytes } from "crypto";

export function generateAutomationId(): string {
  return randomBytes(16).toString("hex");
}

export function generateAutomationSecret(): string {
  return randomBytes(32).toString("hex");
}
