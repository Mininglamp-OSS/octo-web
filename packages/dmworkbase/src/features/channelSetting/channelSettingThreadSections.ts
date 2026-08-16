import { ChannelSettingRouteData } from "../../Components/ChannelSetting/context";
import RouteContext from "../../Service/Context";
import { Section } from "../../Service/Section";
import { buildThreadInfoSection } from "./channelSettingThreadInfoSection";
import { buildThreadMdSection } from "./channelSettingThreadMdSection";
import { buildThreadWebhookSection } from "./channelSettingThreadWebhookSection";
import { ChannelSettingInputEditPush } from "./types";

export { buildThreadInfoSection } from "./channelSettingThreadInfoSection";
export { buildThreadMdSection } from "./channelSettingThreadMdSection";
export { buildThreadWebhookSection } from "./channelSettingThreadWebhookSection";
export { buildThreadActionsSection } from "./channelSettingThreadActionsSection";

export function buildThreadOverviewSection(
  context: RouteContext<ChannelSettingRouteData>,
  inputEditPush: ChannelSettingInputEditPush
) {
  const sections = [
    buildThreadInfoSection(context, inputEditPush),
    buildThreadMdSection(context),
    buildThreadWebhookSection(context),
  ];
  const rows = sections.flatMap((section) => section?.rows || []);
  return rows.length > 0 ? new Section({ rows }) : undefined;
}
