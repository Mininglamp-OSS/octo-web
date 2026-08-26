import fs from "fs";
import { dirname } from "path";

/**
 * The persisted trust store contains URL.host values (hostname plus a
 * non-default port), not complete URLs. Keep the value canonical and reject
 * anything that could smuggle a path, credentials, query, or fragment into a
 * host entry.
 */
export function normalizeTrustedHost(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  try {
    const parsed = new URL(`https://${raw}`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    // WHATWG URL drops a scheme-default port (https://x:443 → host "x"),
    // but the caller's URL may have carried that port under a different
    // scheme (http://x:443 → host "x:443"). Trust keys must preserve every
    // explicit port, otherwise approval of http://x:443 silently widens to
    // bare x after a restart. Re-append an explicit trailing port when
    // normalization stripped it.
    const explicitPort = /:(\d+)$/.exec(raw);
    if (explicitPort && !parsed.port) {
      return `${parsed.hostname}:${explicitPort[1]}`;
    }
    return parsed.host;
  } catch {
    return null;
  }
}

function uniqueTrustedHosts(hosts: Iterable<unknown>): string[] {
  const normalized = new Set<string>();
  for (const host of Array.from(hosts)) {
    const value = normalizeTrustedHost(host);
    if (value) normalized.add(value);
  }
  return Array.from(normalized);
}

/** Read and sanitize the user-managed trust list. Invalid files fail closed. */
export function readFleetTrustedHosts(filePath: string): string[] {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(raw) ? uniqueTrustedHosts(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Atomically replace the user-managed trust list. A unique temporary path
 * prevents concurrent native-dialog writes from sharing a rename target.
 */
export function writeFleetTrustedHosts(filePath: string, hosts: Iterable<unknown>): void {
  const next = uniqueTrustedHosts(hosts);
  fs.mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(next, null, 2), "utf8");
  try {
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try { fs.unlinkSync(tempPath); } catch { /* best effort cleanup */ }
    throw error;
  }
}

/** Add a host and return the resulting canonical list. */
export function addFleetTrustedHost(filePath: string, host: string): string[] {
  const normalized = normalizeTrustedHost(host);
  if (!normalized) throw new Error("invalid trusted host");
  const current = readFleetTrustedHosts(filePath);
  if (!current.includes(normalized)) {
    current.push(normalized);
    writeFleetTrustedHosts(filePath, current);
  }
  return current;
}

/** Remove one exact host and return the resulting canonical list. */
export function removeFleetTrustedHost(filePath: string, host: string): string[] {
  const normalized = normalizeTrustedHost(host);
  if (!normalized) throw new Error("invalid trusted host");
  const current = readFleetTrustedHosts(filePath);
  const next = current.filter((candidate) => candidate !== normalized);
  if (next.length !== current.length) writeFleetTrustedHosts(filePath, next);
  return next;
}
