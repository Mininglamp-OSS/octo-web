import APIClient from "./APIClient"
export interface FoldedChat { channel_id: string; channel_type: number }
export const foldKey = (chat: FoldedChat) => `${chat.channel_type}::${chat.channel_id}`
export default {
 list(spaceId: string): Promise<FoldedChat[]> {
  return APIClient.shared.get("/conversation/folded", { headers: { "X-Space-Id": spaceId } })
 },
 set(spaceId: string, chat: FoldedChat, folded: boolean): Promise<void> {
  return APIClient.shared.put("/conversation/folded", { ...chat, folded }, { headers: { "X-Space-Id": spaceId } })
 },
}
