// MSW browser worker — 仅在 VITE_E2E_MOCK=1 时被 src/index.tsx import 并 start.
// dev / prod 完全不 import → tree-shake 掉, 零副作用.
import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

export const worker = setupWorker(...handlers);
