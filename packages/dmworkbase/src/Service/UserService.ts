import APIClient from "./APIClient"

export interface UserProfile {
  vercode?: string
  [key: string]: any
}

const UserService = {
  getUserProfile(uid: string, groupNo?: string): Promise<UserProfile> {
    return APIClient.shared.get(`users/${uid}`, {
      param: { group_no: groupNo || "" },
    })
  },
}

export default UserService
