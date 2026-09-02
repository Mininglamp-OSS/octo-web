import * as mockApi from "./skillApiMock";
import * as realApi from "./skillApiReal";
import { withReviewInvalidation } from "./reviewSignal";

export type {
  CreateReviewRequestInput,
  DelistPluginInput,
  PluginConflictReason,
  PluginListingResult,
  PluginListOptions,
  PublishPluginInput,
  RequestOptions,
  ReviewListParams,
  ReviewRelationInput,
} from "./skillApiReal";
// Error readers, not endpoints: they only inspect a rejected promise, so there
// is nothing for the mock module to substitute — the mock throws the same
// SkillMarketApiError shape on purpose.
export {
  SkillMarketApiError,
  pluginConflictReason,
  pluginRequiredRole,
} from "./skillApiReal";

const env = (import.meta as { env?: Record<string, string | boolean | undefined> }).env;
const processEnv = typeof process === "undefined" ? undefined : process.env;
const useMock = env?.VITE_USE_MOCK === "true" || processEnv?.VITE_USE_MOCK === "true";
const api = useMock ? mockApi : realApi;

// NOTE: `VITE_USE_MOCK` only swaps the CRUD + review endpoints below. The
// upload / parse / poll pipeline (initUpload / uploadFile / uploadIcon /
// triggerParse / pollParse / initReupload)
// is always bound to the real backend — the mock module has no upload
// surface. A dev enabling mock mode still hits real network on the upload
// step; use a real dev backend if you need the full flow.
//
// Every name below MUST exist in BOTH skillApiMock and skillApiReal: an entry
// missing from the mock module resolves to `undefined` under VITE_USE_MOCK
// rather than failing at import time.
export const getCategories = api.getCategories;
export const getSkills = api.getSkills;
export const getMySkills = api.getMySkills;
export const getSkillTags = api.getSkillTags;
export const getSkill = api.getSkill;
export const trackSkillView = api.trackSkillView;
export const createSkill = api.createSkill;
export const updateSkill = api.updateSkill;
// Deleting a plugin takes any open request on it with it, so the reviewer's
// queue — and the sidebar count — shrink without anybody touching the queue.
export const deleteSkill = withReviewInvalidation(api.deleteSkill);
export const listVersions = api.listVersions;
// ─── Review mutations ──────────────────────────────────────────────────────
//
// Everything below moves the Space's pending count, and every decision path in
// both market packages funnels through these names (dmworkmcp reaches them via
// `dmworkmcp/src/api/pluginReview.ts`, which re-exports from here). Wrapping
// them is therefore the ONE place that can guarantee the 组织发布管理 sidebar
// badge and the 待审核 list are invalidated together — see `reviewSignal.ts`
// for why this lives on the endpoint rather than on its callers.
export const createReviewRequest = withReviewInvalidation(api.createReviewRequest);
export const listReviewRequests = api.listReviewRequests;
export const getReviewRequest = api.getReviewRequest;
export const approveReview = withReviewInvalidation(api.approveReview);
export const rejectReview = withReviewInvalidation(api.rejectReview);
export const cancelReview = withReviewInvalidation(api.cancelReview);
// 发布 opens a review request when the plugin is org-visible (the backend, not
// the caller, decides), and 下架 closes out an approved one.
export const publishPlugin = withReviewInvalidation(api.publishPlugin);
export const delistPlugin = withReviewInvalidation(api.delistPlugin);
export const initUpload = realApi.initUpload;
export const uploadFile = realApi.uploadFile;
export const uploadIcon = realApi.uploadIcon;
export const triggerParse = realApi.triggerParse;
export const pollParse = realApi.pollParse;
export const initReupload = realApi.initReupload;
export const getSkillMd = realApi.getSkillMd;
