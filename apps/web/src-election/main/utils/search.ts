import { randomBytes } from "node:crypto";

export function getRandomSid() {
  const array = randomBytes(4);
  return Array.from(array, (b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 6);
}
