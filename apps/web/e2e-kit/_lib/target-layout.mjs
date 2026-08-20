import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const CANDIDATES = ["e2e", "e2e-kit", "apps/web/e2e-kit"];
const MARKERS = ["manifest.yaml", "fixtures-authed.ts", "case-specs/TEMPLATE.md"];

function hasMarker(root) {
  return MARKERS.some((marker) => existsSync(resolve(root, marker)));
}

/** Resolve the project's e2e root without requiring downstream script edits. */
export function resolveE2ERoot(repoRoot = process.cwd()) {
  const configured = process.env.E2E_TARGET_DIR;
  if (configured) {
    const root = isAbsolute(configured) ? configured : resolve(repoRoot, configured);
    if (!hasMarker(root)) {
      throw new Error(
        `[e2e] E2E_TARGET_DIR=${configured} has no kit markers (${MARKERS.join(", ")})`,
      );
    }
    return root;
  }
  for (const candidate of CANDIDATES) {
    const root = resolve(repoRoot, candidate);
    if (hasMarker(root)) return root;
  }
  throw new Error(
    `[e2e] 无法识别 e2e 根目录，请在仓库根目录运行，或设置包含 kit markers 的 E2E_TARGET_DIR (${MARKERS.join(", ")})`,
  );
}
