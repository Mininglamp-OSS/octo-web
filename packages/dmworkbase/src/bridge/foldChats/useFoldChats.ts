import { useEffect, useRef, useState } from "react"
import FoldChatService, { foldKey, FoldedChat } from "../../Service/FoldChatService"

export function useFoldChats(scope: string, spaceId: string) {
 const [state, setState] = useState({ scope: "", keys: new Set<string>(), loading: true, error: false })
 const [retry, setRetry] = useState(0)
 const generation = useRef(0)
 const busy = useRef(new Set<string>())
 useEffect(() => {
  const gen = ++generation.current
  busy.current.clear()
  setState({ scope, keys: new Set(), loading: true, error: false })
  if (!spaceId) return
  FoldChatService.list(spaceId).then(rows => {
   if (gen === generation.current) setState({ scope, keys: new Set(rows.map(foldKey)), loading: false, error: false })
  }).catch(() => {
   if (gen === generation.current) setState({ scope, keys: new Set(), loading: false, error: true })
  })
  return () => { generation.current++ }
 }, [scope, spaceId, retry])
 const ready = state.scope === scope && !state.loading && !state.error
 const setFolded = async (chat: FoldedChat, folded: boolean) => {
  const key = foldKey(chat), gen = generation.current
  if (!ready || busy.current.has(key)) return false
  busy.current.add(key)
  try {
   await FoldChatService.set(spaceId, chat, folded)
   if (gen !== generation.current) return false
   setState(prev => {
    const keys = new Set(prev.keys)
    if (folded) keys.add(key); else keys.delete(key)
    return { ...prev, keys }
   })
   return true
  } finally { if (gen === generation.current) busy.current.delete(key) }
 }
 return { keys: state.scope === scope ? state.keys : new Set<string>(), ready, error: state.scope === scope && state.error, reload: () => setRetry(n => n + 1), setFolded }
}
