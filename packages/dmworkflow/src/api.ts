// Top-level API alias — re-exports the Flow / Execution API surface so
// callers can do either:
//
//   import * as flowApi from "@dmwork/flow/src/api";
//   import * as flowApi from "@dmwork/flow/src/api/flowApi";
//
// Both resolve to the same module.
export * from "./api/flowApi";
