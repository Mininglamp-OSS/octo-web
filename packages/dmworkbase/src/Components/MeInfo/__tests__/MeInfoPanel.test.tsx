// @vitest-environment jsdom
import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"
import { fireEvent, screen } from "@testing-library/dom"
import "@testing-library/jest-dom/vitest"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import MeInfoPanel, { MeInfoPanelProps } from "../MeInfoPanel"

vi.mock("@douyinfe/semi-ui", () => ({
  Input: (props: any) => React.createElement("input", props),
  Spin: () => React.createElement("span", { "data-testid": "spin" }),
}))

vi.mock("../../RealnameVerifiedBadge", () => ({
  default: () => React.createElement("span", { "data-testid": "verified-badge" }),
}))

vi.mock("../../WKButton", () => ({
  default: ({ children, ...props }: any) =>
    React.createElement("button", props, children),
}))

let container: HTMLDivElement

const baseProps = (overrides: Partial<MeInfoPanelProps> = {}): MeInfoPanelProps => ({
  avatar: React.createElement("span", null, "A"),
  avatarMini: React.createElement("span", null, "A"),
  displayName: "Alice",
  isRealnameVerified: false,
  shortNo: "octo_123",
  profileTitle: "Profile",
  preferencesTitle: "Preferences",
  securityTitle: "Security",
  avatarLabel: "Avatar",
  nameLabel: "Name",
  shortNoLabel: "OCTO ID",
  qrcodeLabel: "QR code",
  genderLabel: "Gender",
  realnameLabel: "Real-name verification",
  experimentalFeaturesLabel: "Experimental features",
  avatarActionLabel: "Change avatar",
  editNameLabel: "Edit name",
  namePlaceholder: "Set name",
  notSetLabel: "Not set",
  saveLabel: "Save",
  cancelLabel: "Cancel",
  nameValue: "Alice",
  nameDraft: "Alice",
  genderValue: "Female",
  realnameValue: "Verify now",
  showExperimentalFeatures: false,
  editingName: false,
  savingName: false,
  uploadingAvatar: false,
  onChooseAvatar: vi.fn(),
  onStartEditName: vi.fn(),
  onNameDraftChange: vi.fn(),
  onCancelName: vi.fn(),
  onSaveName: vi.fn(),
  onShortNoTap: vi.fn(),
  onShowQrCode: vi.fn(),
  onShowGender: vi.fn(),
  onRealnameClick: vi.fn(),
  onShowExperimentalFeatures: vi.fn(),
  ...overrides,
})

const renderPanel = (props: MeInfoPanelProps) => {
  act(() => {
    ReactDOM.render(React.createElement(MeInfoPanel, props), container)
  })
}

describe("MeInfoPanel", () => {
  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container)
    })
    container.remove()
  })

  it("keeps the OCTO ID row wired to the lab-mode tap gesture", () => {
    const onShortNoTap = vi.fn()
    renderPanel(baseProps({ onShortNoTap }))

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /OCTO ID\s*octo_123/ }))
    })

    expect(onShortNoTap).toHaveBeenCalledTimes(1)
  })

  it("keeps real-name verification actionable in embedded settings", () => {
    const onRealnameClick = vi.fn()
    renderPanel(baseProps({ embedded: true, onRealnameClick }))

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Real-name verification\s*Verify now/ }))
    })

    expect(onRealnameClick).toHaveBeenCalledTimes(1)
  })

  it("places contact rows before the OCTO ID row", () => {
    renderPanel(baseProps({
      phoneLabel: "Phone",
      phoneValue: "13800138000",
      emailLabel: "Email",
      emailValue: "alice@example.com",
    }))

    const rows = Array.from(container.querySelectorAll(".wk-meinfo-section-rows")).flatMap((section) =>
      Array.from(section.querySelectorAll(":scope > .wk-meinfo-row")).map((row) => row.textContent),
    )
    expect(rows.indexOf("Phone13800138000")).toBeLessThan(rows.indexOf("OCTO IDocto_123"))
    expect(rows.indexOf("Emailalice@example.com")).toBeLessThan(rows.indexOf("OCTO IDocto_123"))
  })

  it("keeps contact values interactive so callers can copy them", () => {
    const onCopyPhone = vi.fn()
    const onCopyEmail = vi.fn()
    renderPanel(baseProps({
      phoneLabel: "Phone",
      phoneValue: React.createElement("button", { onClick: onCopyPhone }, "13800138000"),
      emailLabel: "Email",
      emailValue: React.createElement("button", { onClick: onCopyEmail }, "alice@example.com"),
    }))

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "13800138000" }))
      fireEvent.click(screen.getByRole("button", { name: "alice@example.com" }))
    })

    expect(onCopyPhone).toHaveBeenCalledTimes(1)
    expect(onCopyEmail).toHaveBeenCalledTimes(1)
  })
})
