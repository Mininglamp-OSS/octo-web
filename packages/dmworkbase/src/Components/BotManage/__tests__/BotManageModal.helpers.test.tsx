import { describe, expect, it, vi } from "vitest"
import BotManageModal from "../index"

describe("BotManageModal lifecycle helpers", () => {
  it("creates labels lazily and resets both VMs when the bot changes", () => {
    const modal: any = new BotManageModal({ robotId: "bot-a", visible: true, onClose: vi.fn() })
    modal.context = { t: (key: string) => key }

    const labels = modal.createLabels()
    expect(labels.mentionFree).toBe("base.botManage.menu.mentionFree")
    expect(labels.sectionEnabled(2)).toBe("base.botManage.mentionFree.sectionEnabled")
    const cardLabels = modal.createCardLabels()
    expect(Object.keys(cardLabels.rowTitle)).toHaveLength(3)
    expect(Object.values(cardLabels.rowDesc)).toHaveLength(3)

    const cardVm = modal.ensureCardSettingsVM()
    expect(cardVm).toBe(modal.ensureCardSettingsVM())
    const setRobotId = vi.fn()
    modal.vm = { setRobotId }
    modal.componentDidUpdate({ robotId: "bot-old", visible: true, onClose: vi.fn() })
    expect(setRobotId).toHaveBeenCalledWith("bot-a")
    expect(modal.cardSettingsVM).toBeUndefined()
    modal.componentWillUnmount()
  })

  it("does not reset state when the robot id is unchanged", () => {
    const modal: any = new BotManageModal({ robotId: "same", visible: false, onClose: vi.fn() })
    const setRobotId = vi.fn()
    modal.vm = { setRobotId }
    modal.cardSettingsVM = { dispose: vi.fn() }
    modal.componentDidUpdate({ robotId: "same", visible: false, onClose: vi.fn() })
    expect(setRobotId).not.toHaveBeenCalled()
    expect(modal.cardSettingsVM).toBeDefined()
  })
})
