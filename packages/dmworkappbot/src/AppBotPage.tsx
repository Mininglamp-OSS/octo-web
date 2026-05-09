import React, { useEffect, useMemo, useRef, useState } from "react"
import { Channel, ChannelTypePerson, ChannelInfo, WKSDK } from "wukongimjssdk"
import { WKApp, Conversation, SpaceService } from "@octo/base"
import "./AppBotPage.css"

interface AppBotInfo {
  id: string
  uid: string
  display_name: string
  description: string
  avatar: string
  scope: "platform" | "space"
}

type LoadState = "loading" | "ready" | "error"

// Default bot avatar as SVG data URI — used when bot.avatar is empty.
// This ensures avatarChannel() uses this instead of falling back to
// /users/{uid}/avatar (which returns 404 for bot UIDs).
const BOT_DEFAULT_AVATAR_DATA_URI = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">'
  + '<rect width="80" height="80" rx="16" fill="#667eea"/>'
  + '<rect x="14" y="26" width="52" height="40" rx="10" stroke="white" stroke-width="3" fill="rgba(255,255,255,0.2)"/>'
  + '<circle cx="30" cy="46" r="5" fill="white"/>'
  + '<circle cx="50" cy="46" r="5" fill="white"/>'
  + '<path d="M32 56c2 4 5 6 8 6s6-2 8-6" stroke="white" stroke-width="3" stroke-linecap="round" fill="none"/>'
  + '<line x1="40" y1="12" x2="40" y2="26" stroke="white" stroke-width="3" stroke-linecap="round"/>'
  + '<circle cx="40" cy="10" r="5" fill="white"/>'
  + '</svg>'
)

const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
  "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
  "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
  "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)",
  "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
  "linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)",
  "linear-gradient(135deg, #fccb90 0%, #d57eeb 100%)",
  "linear-gradient(135deg, #5ee7df 0%, #b490ca 100%)",
]

function pickGradient(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0
  }
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length]
}

function isSafeImageUrl(url: string): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url, window.location.origin)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

function BotIconFallback() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <rect x="4" y="8" width="16" height="12" rx="3" stroke="white" strokeWidth="1.5" fill="rgba(255,255,255,0.2)" />
      <circle cx="9" cy="14" r="1.5" fill="white" />
      <circle cx="15" cy="14" r="1.5" fill="white" />
      <path d="M9.5 17.5C10 18.5 11 19 12 19C13 19 14 18.5 14.5 17.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="12" y1="4" x2="12" y2="8" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="3.5" r="1.5" fill="white" />
    </svg>
  )
}

/** Lightweight error toast — self-removing DOM element, no external dependency. */
function showErrorToast(message: string) {
  const el = document.createElement("div")
  Object.assign(el.style, {
    position: "fixed",
    top: "16px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "10000",
    padding: "8px 16px",
    borderRadius: "6px",
    fontSize: "13px",
    fontWeight: "500",
    color: "#dc2626",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
    opacity: "0",
    transition: "opacity 200ms ease",
  })
  el.textContent = message
  document.body.appendChild(el)
  requestAnimationFrame(() => { el.style.opacity = "1" })
  setTimeout(() => {
    el.style.opacity = "0"
    setTimeout(() => el.remove(), 200)
  }, 3000)
}

/** Bot chat header — renders directly from bot data, bypasses SDK channelInfo */
function BotChatHeader({ bot }: { bot: AppBotInfo }) {
  const showImg = isSafeImageUrl(bot.avatar)
  return (
    <div className="appbot-chat-header">
      <div
        className="appbot-chat-header-avatar"
        style={!showImg ? { background: pickGradient(bot.uid || bot.id) } : undefined}
      >
        {showImg ? <img src={bot.avatar} alt={bot.display_name} /> : <BotIconFallback />}
      </div>
      <div className="appbot-chat-header-name">{bot.display_name}</div>
    </div>
  )
}

export default function AppBotPage() {
  const [bots, setBots] = useState<AppBotInfo[]>([])
  const [state, setState] = useState<LoadState>("loading")
  const [spaceName, setSpaceName] = useState("")
  const [keyword, setKeyword] = useState("")
  const [selectedUid, setSelectedUid] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    let stale = false
    let requestId = 0

    const loadData = async () => {
      const thisRequest = ++requestId
      setState("loading")
      try {
        const spaceId = WKApp.shared.currentSpaceId
        const params = spaceId ? { param: { space_id: spaceId } } : undefined
        const res = await WKApp.apiClient.get("/app_bot/available", params)
        if (stale || thisRequest !== requestId) return
        const items = Array.isArray(res) ? res.filter((b: AppBotInfo) => b && b.uid && b.id) : []
        setBots(items)
        setState("ready")
      } catch (err) {
        console.warn("[AppBotPage] Failed to load bots:", err)
        if (stale || thisRequest !== requestId) return
        setBots([])
        setState("error")
      }
    }

    const resolveSpaceName = async () => {
      const spaceId = WKApp.shared.currentSpaceId
      if (!spaceId) { if (!stale) setSpaceName(""); return }
      try {
        const spaces = await SpaceService.shared.getMySpaces()
        if (stale) return
        const found = spaces?.find((s: { space_id: string; name?: string }) => s.space_id === spaceId)
        setSpaceName(found?.name || "")
      } catch { if (!stale) setSpaceName("") }
    }

    loadData()
    resolveSpaceName()

    const handler = () => {
      isSelectingRef.current = false
      setSelectedUid(null)
      WKApp.routeRight.popToRoot()
      loadData()
      resolveSpaceName()
    }
    WKApp.mittBus.on("space-changed", handler)
    return () => { stale = true; WKApp.mittBus.off("space-changed", handler) }
  }, [reloadTick])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return bots
    return bots.filter((b) =>
      (b.display_name || "").toLowerCase().includes(kw) ||
      (b.description || "").toLowerCase().includes(kw)
    )
  }, [bots, keyword])

  const platformBots = useMemo(() => filtered.filter((b) => b.scope === "platform"), [filtered])
  const spaceBots = useMemo(() => filtered.filter((b) => b.scope === "space"), [filtered])

  const isSelectingRef = useRef(false)

  const handleSelect = async (bot: AppBotInfo) => {
    if (isSelectingRef.current) return
    isSelectingRef.current = true
    try {
      // Ensure friend relationship with bot (opt-in consent).
      // This is idempotent — already-friends returns OK immediately.
      await WKApp.apiClient.post("/app_bot/apply", { robot_uid: bot.uid })

      setSelectedUid(bot.uid)

      const channel = new Channel(bot.uid, ChannelTypePerson)

      // Write bot identity to channelManager FIRST — Conversation component
      // reads this for message row avatars/names. Must be set before any
      // component renders or triggers fetchChannelInfo.
      const info = new ChannelInfo()
      info.channel = channel
      info.title = bot.display_name
      // When bot has no avatar, use a data URI so avatarChannel() uses it
      // instead of falling back to /users/{uid}/avatar (which 404s for bots)
      info.logo = bot.avatar || BOT_DEFAULT_AVATAR_DATA_URI
      info.orgData = { displayName: bot.display_name, robot: 1, name: bot.display_name }
      WKSDK.shared().channelManager.setChannleInfoForCache(info)

      // Ensure conversation exists in SDK
      const convMgr = WKSDK.shared().conversationManager
      if (!convMgr.findConversation(channel) && convMgr.createEmptyConversation) {
        convMgr.createEmptyConversation(channel)
      }

      // Render bot chat: our header + Conversation (messages + input only)
      WKApp.routeRight.replaceToRoot(
        <div key={channel.getChannelKey()} className="appbot-chat-wrap">
          <BotChatHeader bot={bot} />
          <Conversation channel={channel} />
        </div>
      )
    } catch (err) {
      console.error("[AppBotPage] handleSelect failed:", err)
      showErrorToast("无法连接到该应用，请稍后重试")
    } finally {
      isSelectingRef.current = false
    }
  }

  const renderItem = (bot: AppBotInfo) => {
    const isActive = selectedUid === bot.uid
    const showImg = isSafeImageUrl(bot.avatar)
    return (
      <div
        key={bot.id}
        className={`appbot-list-item ${isActive ? "appbot-list-item-active" : ""}`}
        onClick={() => handleSelect(bot)}
      >
        <div
          className="appbot-list-avatar"
          style={!showImg ? { background: pickGradient(bot.uid || bot.id) } : undefined}
        >
          {showImg ? <img src={bot.avatar} alt={bot.display_name} /> : <BotIconFallback />}
        </div>
        <div className="appbot-list-info">
          <div className="appbot-list-name">{bot.display_name}</div>
          <div className="appbot-list-desc">{bot.description || "应用 Bot"}</div>
        </div>
      </div>
    )
  }

  const renderSection = (title: string, list: AppBotInfo[]) => {
    if (list.length === 0) return null
    return (
      <div className="appbot-list-section" key={title}>
        <div className="appbot-list-section-title">{title}</div>
        {list.map(renderItem)}
      </div>
    )
  }

  return (
    <div className="appbot-page">
      <div className="appbot-page-header">
        <div className="appbot-page-title">应用</div>
        <input
          type="search"
          className="appbot-search-input"
          placeholder="搜索"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>
      <div className="appbot-page-list">
        {state === "loading" && (
          <div className="appbot-list-status">
            <div className="appbot-spinner" />
            <span>加载中...</span>
          </div>
        )}
        {state === "error" && (
          <div className="appbot-list-status">
            <span>加载失败</span>
            <button className="appbot-retry-btn" onClick={() => setReloadTick((t) => t + 1)}>重试</button>
          </div>
        )}
        {state === "ready" && filtered.length === 0 && (
          <div className="appbot-list-status">
            <span>{keyword ? "未找到匹配的应用" : "暂无可用应用"}</span>
          </div>
        )}
        {state === "ready" && (
          <>
            {renderSection("平台应用", platformBots)}
            {renderSection(spaceName ? `空间应用 · ${spaceName}` : "空间应用", spaceBots)}
          </>
        )}
      </div>
    </div>
  )
}
