import APIClient from "./APIClient"

export interface UserProfile {
  vercode?: string
  [key: string]: any
}

export interface UserProfileRequestOptions {
  /** Let standalone pages preserve their deep link while they recover a 401. */
  suppressAuthExpiredLogout?: boolean
}

export interface FriendApplyRequest {
  uid: string
  remark: string
  vercode?: string
  spaceId?: string
}

export interface UpdateCurrentUserPayload {
  name?: string
  sex?: string | number
  [key: string]: string | number | undefined
}

const UserService = {
  getUserProfile(
    uid: string,
    groupNo?: string,
    options?: UserProfileRequestOptions,
  ): Promise<UserProfile> {
    return APIClient.shared.get(`users/${uid}`, {
      param: { group_no: groupNo || "" },
      ...(options?.suppressAuthExpiredLogout !== undefined
        ? { suppressAuthExpiredLogout: options.suppressAuthExpiredLogout }
        : {}),
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

  updateCurrentUser(payload: UpdateCurrentUserPayload): Promise<any> {
    return APIClient.shared.put("user/current", payload)
  },

  uploadUserAvatar(uid: string, file: File): Promise<any> {
    const data = new FormData()
    data.append("file", file)
    return APIClient.shared.post(`users/${uid}/avatar`, data, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 60_000,
    })
  },
}

export default UserService
