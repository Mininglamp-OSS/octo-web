// Minimal ambient typing for the Vite HMR handle used in module.tsx.
// Kept local (rather than `vite/client`) so `tsc -p` doesn't depend on Vite's
// types resolving from the package dir.
interface ImportMeta {
  readonly hot?: {
    dispose(cb: (data: unknown) => void): void;
    accept(cb?: (mod: unknown) => void): void;
  };
}

// @types/react-dom isn't installed in this monorepo (matches dmworktodo). The
// react-dom@17 render API is only used by the test harness; declare it loosely
// so `tsc -p` stays clean without adding a dependency.
declare module 'react-dom';
declare module 'react-dom/test-utils';
