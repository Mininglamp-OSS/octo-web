import type { Page } from "@playwright/test";

type ReadyOptions = {
  readyKey: string;
  errorKey?: string;
  timeout?: number;
  label?: string;
};

/** Wait for a browser-side readiness marker and surface an explicit error marker. */
export async function waitForE2EReady(page: Page, options: ReadyOptions): Promise<void> {
  const { readyKey, errorKey, timeout = 15_000, label = readyKey } = options;
  await page.waitForFunction(
    ({ readyKey: key, errorKey: error }) => {
      const state = globalThis as Record<string, unknown>;
      if (error && state[error]) throw new Error(String(state[error]));
      return state[key] === true;
    },
    { readyKey, errorKey },
    { timeout },
  ).catch((cause) => {
    throw new Error(`[e2e readiness] ${label} 未就绪 (${timeout}ms): ${cause.message}`);
  });
}

export function waitForMswReady(page: Page, timeout = 15_000): Promise<void> {
  return waitForE2EReady(page, {
    readyKey: "__MSW_READY__",
    timeout,
    label: "MSW",
  });
}

export function waitForMockSeedReady(page: Page, timeout = 15_000): Promise<void> {
  return waitForE2EReady(page, {
    readyKey: "__e2eVoiceSeedReady__",
    errorKey: "__e2eVoiceSeedError__",
    timeout,
    label: "mock seed",
  });
}
