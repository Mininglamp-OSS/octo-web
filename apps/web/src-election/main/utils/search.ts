import { randomBytes } from 'crypto';

export function getRandomSid() {
  return randomBytes(4).toString('hex').slice(0, 6);
}
