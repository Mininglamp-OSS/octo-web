import axios from "axios"
import APIClient from "./APIClient"

export interface BotProfile {
  bot_creator_uid?: string
  bot_creator_name?: string
  bot_description?: string
  bot_commands?: string
  follow?: number
  name?: string
  remark?: string
  username?: string
  [key: string]: any
}

export interface BotFriendApplyRequest {
  uid: string
  remark: string
  spaceId?: string
}

const BotProfileService = {
  getBotProfile(uid: string): Promise<BotProfile> {
    return APIClient.shared.get(`users/${uid}`)
  },

  updateDescription(uid: string, description: string): Promise<void> {
    return APIClient.shared.put(`robot/${uid}/description`, { description })
  },

  updateRemark(uid: string, remark: string): Promise<void> {
    return APIClient.shared.put("friend/remark", { uid, remark })
  },

  applyFriend(request: BotFriendApplyRequest): Promise<void> {
    const body: Record<string, string> = {
      to_uid: request.uid,
      remark: request.remark,
    }
    if (request.spaceId) {
      body.space_id = request.spaceId
    }
    return APIClient.shared.post("friend/apply", body)
  },

  uploadAvatar(uid: string, file: File, token?: string): Promise<void> {
    const form = new FormData()
    form.append("file", file)
    return axios
      .post(`users/${uid}/avatar`, form, {
        headers: {
          "Content-Type": "multipart/form-data",
          token: token || "",
        },
      })
      .then(() => undefined)
  },
}

export default BotProfileService
