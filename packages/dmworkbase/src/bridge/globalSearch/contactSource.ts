import { Channel, ChannelTypePerson } from "wukongimjssdk";
import type { LegacyGlobalSearchContact } from "../../Service/SearchService";
import { getCurrentImChannelInfo } from "../../im-runtime/currentChannelRuntime";
import { resolveExternalForViewer } from "../../Utils/externalViewer";

type SourceMetadata = Record<string, unknown>;

function metadataFields(source: SourceMetadata) {
  const homeId = source.home_space_id;
  const homeName = source.home_space_name;
  const external = source.is_external;
  const sourceName = source.source_space_name;
  return {
    homeSpaceId: typeof homeId === "string" ? homeId : undefined,
    homeSpaceName: typeof homeName === "string" ? homeName : undefined,
    isExternalLegacy: typeof external === "number" ? external : undefined,
    sourceSpaceNameLegacy:
      typeof sourceName === "string" ? sourceName : undefined,
  };
}

function contactSourceFields(contact: LegacyGlobalSearchContact) {
  const direct = metadataFields(contact);
  const orgData = contact.orgData;
  if (typeof orgData !== "object" || orgData === null) return direct;
  const nested = metadataFields(orgData as SourceMetadata);
  return {
    homeSpaceId: direct.homeSpaceId ?? nested.homeSpaceId,
    homeSpaceName: direct.homeSpaceName ?? nested.homeSpaceName,
    isExternalLegacy: direct.isExternalLegacy ?? nested.isExternalLegacy,
    sourceSpaceNameLegacy:
      direct.sourceSpaceNameLegacy ?? nested.sourceSpaceNameLegacy,
  };
}

export function hasGlobalSearchContactSource(
  contact: LegacyGlobalSearchContact
) {
  const fields = contactSourceFields(contact);
  return !!fields.homeSpaceId || fields.isExternalLegacy !== undefined;
}

/** Use the result's source metadata first, then the shared channel cache. */
export function resolveGlobalSearchContactSource(
  contact: LegacyGlobalSearchContact
) {
  let fields = contactSourceFields(contact);
  if (!hasGlobalSearchContactSource(contact) && contact.channel_id) {
    const cached = getCurrentImChannelInfo(
      new Channel(contact.channel_id, ChannelTypePerson)
    )?.orgData;
    if (cached) {
      const fallback = metadataFields(cached as SourceMetadata);
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
