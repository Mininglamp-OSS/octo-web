import * as mockApi from "./skillApiMock";
import * as realApi from "./skillApiReal";

export type {
  CreateReviewRequestInput,
  RequestOptions,
  ReviewListParams,
  ReviewRelationInput,
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
export const deleteSkill = api.deleteSkill;
export const listVersions = api.listVersions;
export const createReviewRequest = api.createReviewRequest;
export const listReviewRequests = api.listReviewRequests;
export const getReviewRequest = api.getReviewRequest;
export const approveReview = api.approveReview;
export const rejectReview = api.rejectReview;
export const cancelReview = api.cancelReview;
export const initUpload = realApi.initUpload;
export const uploadFile = realApi.uploadFile;
export const uploadIcon = realApi.uploadIcon;
export const triggerParse = realApi.triggerParse;
export const pollParse = realApi.pollParse;
export const initReupload = realApi.initReupload;
export const getSkillMd = realApi.getSkillMd;
