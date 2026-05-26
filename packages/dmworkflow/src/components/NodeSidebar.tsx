// NodeSidebar — re-exports the existing left-rail palette under the name the
// issue spec uses. Kept as a thin alias so future imports can pick either:
//
//   import NodeSidebar from "@dmwork/flow/src/components/NodeSidebar";
//   import Sidebar     from "@dmwork/flow/src/components/Sidebar";
//
// Both resolve to the same component.
export { default } from "./Sidebar";
export { default as NodeSidebar } from "./Sidebar";
