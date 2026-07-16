import * as mockApi from "./skillApiMock";
import * as realApi from "./skillApiReal";

export type { RequestOptions } from "./skillApiReal";

const env = (import.meta as { env?: Record<string, string | boolean | undefined> }).env;
const processEnv = typeof process === "undefined" ? undefined : process.env;
const useMock = env?.VITE_USE_MOCK === "true" || processEnv?.VITE_USE_MOCK === "true";
const api = useMock ? mockApi : realApi;

// NOTE: `VITE_USE_MOCK` only swaps the 8 CRUD endpoints below. The upload /
// parse / poll / download pipeline (initUpload / uploadFile / uploadIcon /
// triggerParse / pollParse / initReupload / getDownloadUrl / downloadSkill)
// is always bound to the real backend — the mock module has no upload
// surface. A dev enabling mock mode still hits real network on the upload
// step; use a real dev backend if you need the full flow.
export const getCategories = api.getCategories;
export const getSkills = api.getSkills;
export const getMySkills = api.getMySkills;
export const getSkill = api.getSkill;
export const createSkill = api.createSkill;
export const updateSkill = api.updateSkill;
export const deleteSkill = api.deleteSkill;
export const listVersions = api.listVersions;
export const initUpload = realApi.initUpload;
export const uploadFile = realApi.uploadFile;
export const uploadIcon = realApi.uploadIcon;
export const triggerParse = realApi.triggerParse;
export const pollParse = realApi.pollParse;
export const initReupload = realApi.initReupload;
export const getDownloadUrl = realApi.getDownloadUrl;
export const downloadSkill = realApi.downloadSkill;
