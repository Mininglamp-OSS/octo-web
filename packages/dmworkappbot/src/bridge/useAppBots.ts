import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { SpaceService, WKApp } from "@octo/base"
import AppBotService from "../Service/AppBotService"
import { filterAppBots, groupAppBots, toAppBotViewItem } from "./appBotList"
import type { AppBotLoadState } from "./types"

interface UseAppBotsOptions {
  onSpaceChanged?: () => void
}

export function useAppBots({ onSpaceChanged }: UseAppBotsOptions = {}) {
  const [bots, setBots] = useState(() => [] as ReturnType<typeof toAppBotViewItem>[])
  const [state, setState] = useState<AppBotLoadState>("loading")
  const [spaceName, setSpaceName] = useState("")
  const [keyword, setKeyword] = useState("")
  const [reloadTick, setReloadTick] = useState(0)
  const requestIdRef = useRef(0)

  const reload = useCallback(() => {
    setReloadTick((tick) => tick + 1)
  }, [])

  useEffect(() => {
    let stale = false

    const loadData = async () => {
      const thisRequest = ++requestIdRef.current
      setState("loading")
      try {
        const items = await AppBotService.getAvailableBots(WKApp.shared.currentSpaceId)
        if (stale || thisRequest !== requestIdRef.current) return
        setBots(items.map(toAppBotViewItem))
        setState("ready")
      } catch (err) {
        console.warn("[AppBotPage] Failed to load bots:", err)
        if (stale || thisRequest !== requestIdRef.current) return
        setBots([])
        setState("error")
      }
    }

    const resolveSpaceName = async () => {
      const spaceId = WKApp.shared.currentSpaceId
      if (!spaceId) {
        if (!stale) setSpaceName("")
        return
      }
      try {
        const spaces = await SpaceService.shared.getMySpaces()
        if (stale) return
        const found = spaces?.find((s: { space_id: string; name?: string }) => s.space_id === spaceId)
        setSpaceName(found?.name || "")
      } catch {
        if (!stale) setSpaceName("")
      }
    }

    loadData()
    resolveSpaceName()

    const handler = () => {
      onSpaceChanged?.()
      loadData()
      resolveSpaceName()
    }
    WKApp.mittBus.on("space-changed", handler)
    return () => {
      stale = true
      WKApp.mittBus.off("space-changed", handler)
    }
  }, [onSpaceChanged, reloadTick])

  const filteredBots = useMemo(() => filterAppBots(bots, keyword), [bots, keyword])
  const sections = useMemo(() => groupAppBots(filteredBots), [filteredBots])

  return {
    state,
    keyword,
    setKeyword,
    reload,
    spaceName,
    filteredBots,
    sections,
  }
}
