import APIClient from "./APIClient";

export interface SpaceSetting {
  voice_feedback_on: number;
  voice_feedback_notice_acked: number;
}

export async function getSpaceSetting(spaceId: string): Promise<SpaceSetting> {
  return APIClient.shared.get<SpaceSetting>("/user/space/setting", {
    param: { space_id: spaceId },
  });
}

export async function updateSpaceSetting(
  spaceId: string,
  data: Partial<Pick<SpaceSetting, "voice_feedback_on" | "voice_feedback_notice_acked">>,
): Promise<void> {
  return APIClient.shared.put("/user/space/setting", data, {
    param: { space_id: spaceId },
  });
}
