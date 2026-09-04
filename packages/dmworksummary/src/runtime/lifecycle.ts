import { registerSummaryChatExtension } from "../integration/chatExtension";
import {
  disposeSummaryLegacyNavigation,
  registerSummaryLegacyNavigation,
} from "../integration/legacyNavigation";
import {
  disposeSummaryAttentionRuntime,
  initializeSummaryAttentionRuntime,
} from "./attention";
import {
  registerSummaryCandidateSearch,
  registerSummaryFoundation,
} from "./foundation";

let initialized = false;

export function initializeSummaryWebRuntime(): void {
  if (initialized) return;
  initialized = true;

  registerSummaryFoundation();
  registerSummaryLegacyNavigation();
  initializeSummaryAttentionRuntime();
  registerSummaryCandidateSearch();
  registerSummaryChatExtension();
}

export function disposeSummaryWebRuntime(): void {
  if (!initialized) return;
  disposeSummaryLegacyNavigation();
  disposeSummaryAttentionRuntime();
  initialized = false;
}
