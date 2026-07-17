import { createSearchAssetResolver } from "../../bridge/search/createSearchAssetResolver";
import {
  cnDatePresetRange,
  cleanGlobalFilters,
  endOfCnDaySeconds,
  foldResponse,
  GLOBAL_SEARCH_FILE_TYPES_ENDPOINT,
  globalSearchEndpoint,
  hasEffectiveGlobalFilters,
  mapFilesResponse as mapFilesResponseFromService,
  mapMessagesResponse as mapMessagesResponseFromService,
  secondsToDateOnlyCN,
  shouldRunGlobalSearch,
  startOfCnDaySeconds,
  toGlobalRequestBody,
} from "../../Service/SearchService";
import type { GlobalSearchQuery } from "./types";

export {
  cnDatePresetRange,
  cleanGlobalFilters,
  endOfCnDaySeconds,
  foldResponse,
  GLOBAL_SEARCH_FILE_TYPES_ENDPOINT,
  globalSearchEndpoint,
  hasEffectiveGlobalFilters,
  secondsToDateOnlyCN,
  shouldRunGlobalSearch,
  startOfCnDaySeconds,
  toGlobalRequestBody,
};

export function mapMessagesResponse(resp: unknown, query: GlobalSearchQuery) {
  return mapMessagesResponseFromService(
    resp,
    query,
    createSearchAssetResolver()
  );
}

export function mapFilesResponse(resp: unknown, query: GlobalSearchQuery) {
  return mapFilesResponseFromService(resp, query, createSearchAssetResolver());
}
