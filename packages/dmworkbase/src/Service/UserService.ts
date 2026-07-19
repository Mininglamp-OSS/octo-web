import APIClient from "./APIClient"

export interface UserProfile {
  vercode?: string
  [key: string]: any
}

export interface FriendApplyRequest {
  uid: string
  remark: string
  vercode?: string
  spaceId?: string
}

const UserService = {
  getUserProfile(uid: string, groupNo?: string): Promise<UserProfile> {
    return APIClient.shared.get(`users/${uid}`, {
      param: { group_no: groupNo || "" },
    })
  },

  updateRemark(uid: string, remark: string): Promise<void> {
    return APIClient.shared.put("friend/remark", { uid, remark })
  },

  applyFriend(request: FriendApplyRequest): Promise<void> {
    const body: Record<string, string> = {
      to_uid: request.uid,
      remark: request.remark,
      vercode: request.vercode || "",
    }
    if (request.spaceId) {
      body.space_id = request.spaceId
    }
    return APIClient.shared.post("friend/apply", body)
  },
}

export default UserService
