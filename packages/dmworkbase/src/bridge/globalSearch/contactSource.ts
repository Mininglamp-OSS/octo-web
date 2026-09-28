import { Channel, ChannelTypePerson } from "wukongimjssdk";
import type { LegacyGlobalSearchContact } from "../../Service/SearchService";
import { getCurrentImChannelInfo } from "../../im-runtime/currentChannelRuntime";
import { resolveExternalForViewer } from "../../Utils/externalViewer";

function sourceFields(source: Record<string, unknown>) {
  const org = source.orgData;
  const fields = typeof org === "object" && org !== null ? org : {};
  const homeId =
    source.home_space_id ??
    ("home_space_id" in fields ? fields.home_space_id : undefined);
  const homeName =
    source.home_space_name ??
    ("home_space_name" in fields ? fields.home_space_name : undefined);
  const external =
    source.is_external ??
    ("is_external" in fields ? fields.is_external : undefined);
  const sourceName =
    source.source_space_name ??
    ("source_space_name" in fields ? fields.source_space_name : undefined);
  return {
    homeSpaceId: typeof homeId === "string" ? homeId : undefined,
    homeSpaceName: typeof homeName === "string" ? homeName : undefined,
    isExternalLegacy: typeof external === "number" ? external : undefined,
    sourceSpaceNameLegacy:
      typeof sourceName === "string" ? sourceName : undefined,
  };
}

export function hasGlobalSearchContactSource(
  contact: LegacyGlobalSearchContact
) {
  const fields = sourceFields(contact);
  return !!fields.homeSpaceId || fields.isExternalLegacy !== undefined;
}

/** Use the result's source metadata first, then the shared channel cache. */
export function resolveGlobalSearchContactSource(
  contact: LegacyGlobalSearchContact
) {
  let fields = sourceFields(contact);
  if (!hasGlobalSearchContactSource(contact) && contact.channel_id) {
    const cached = getCurrentImChannelInfo(
      new Channel(contact.channel_id, ChannelTypePerson)
    )?.orgData;
    if (cached) {
      const fallback = sourceFields(cached);
      fields = {
        ...fallback,
        homeSpaceName: fields.homeSpaceName ?? fallback.homeSpaceName,
        sourceSpaceNameLegacy:
          fields.sourceSpaceNameLegacy ?? fallback.sourceSpaceNameLegacy,
      };
    }
  }
  const result = resolveExternalForViewer(fields);
  return result.isExternal ? result.sourceSpaceName : "";
}
