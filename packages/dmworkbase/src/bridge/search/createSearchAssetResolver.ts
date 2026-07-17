import WKApp from "../../App";
import type { SearchAssetResolver } from "../../Service/SearchResultMapper";

/**
 * Adapts host runtime asset URLs for the pure search-result mapper.
 * The Service layer receives this narrow dependency instead of importing WKApp.
 */
export function createSearchAssetResolver(): SearchAssetResolver {
  return {
    image: (path) =>
      WKApp.dataSource?.commonDataSource?.getImageURL?.(path) ||
      `${WKApp.apiClient.config.apiURL || ""}${path}`,
    file: (path) =>
      WKApp.dataSource?.commonDataSource?.getFileURL?.(path) ||
      `${WKApp.apiClient.config.apiURL || ""}${path}`,
  };
}
