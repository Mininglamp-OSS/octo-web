/**
 * MeInfoVM 行为测试
 *
 * 覆盖 Issue 任务 A 单测合同(resolveRealnameVerifyUrl 的 URL 拼接 + provider 分支
 * 已在 realnameVerifyUrl.test.ts 覆盖;本 suite 专注 vm.tsx 里的副作用层):
 *   1. startRealnameVerify: window.open 调用一次,URL 带 return_to,**绝不 fallback
 *      到 window.location.href**(P1 bug 的根因)
 *   2. startRealnameVerify: local 账号 Toast 不跳(保留原有行为)
 *   3. startRealnameVerify: 弹窗被拦截(window.open 返 null)→ toast warning,
 *      不自动替换当前 tab
 *   4. didMount: ?verified=1 回跳流程 → URL 清理 + reloadSelfProfile
 *   5. didMount: 无 ?verified=1 → 仅 reloadSelfProfile, 不再 POST 任何 endpoint
 *
 * dmworkim 的 POST /v1/internal/realname/pull-from-idp endpoint 已废弃。
 * 前端 didMount 不再调该 endpoint(实名同步改走 dmworkim sync_worker 15min 轮询)。
 *
 * 实现注意:vm.tsx 会 import 大量重依赖(WKSDK / axios / wukongimjssdk / semi-ui),
 * 靠 vitest 的 vi.mock + vi.hoisted 在 import 前替换掉无关模块,仅保留业务核心。
 * vi.mock 的 factory 被 hoist 到文件顶,引用普通变量会 TDZ;用 vi.hoisted 把 spy
 * 对象提到同一层级,factory 内即可直接引用。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const hoisted = vi.hoisted(() => {
  const apiClientPost = vi.fn()
  const apiClientGet = vi.fn()
  const toastError = vi.fn()
  const toastWarning = vi.fn()
  const channelManager = {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }
  const fakeWKApp = {
    loginInfo: {
      uid: "uid-1",
      loginProvider: "xming",
      realnameVerified: false,
      realName: undefined as string | undefined,
      realnameVerifiedAt: undefined as number | undefined,
      name: "Name",
      shortNo: "1234",
      sex: 1,
      save: vi.fn(),
    },
    remoteConfig: {
      oidcProviders: [
        {
          id: "xming",
          name: "xming",
          authorizePath: "/auth/oidc/xming/authorize",
          accountUrl: "https://accounts-test.imocto.cn",
        },
      ],
    },
    apiClient: {
      post: apiClientPost,
      get: apiClientGet,
      config: { apiURL: "" },
    },
    shared: {
      myUserAvatarChange: vi.fn(),
      avatarUser: () => "/avatar.png",
      changeChannelAvatarTag: vi.fn(),
    },
    config: { appName: "OCTO" },
  }
  return { apiClientPost, apiClientGet, toastError, toastWarning, channelManager, fakeWKApp }
})

vi.mock("wukongimjssdk", () => {
  return {
    default: { shared: () => ({ channelManager: hoisted.channelManager }) },
    Channel: class {
      constructor(public channelID: string, public channelType: number) {}
    },
    ChannelInfo: class {},
    ChannelTypePerson: 1,
    __esModule: true,
  }
})

vi.mock("axios", () => ({ default: { post: vi.fn() } }))

vi.mock("@douyinfe/semi-ui", () => ({
  Toast: {
    error: hoisted.toastError,
    warning: hoisted.toastWarning,
    info: hoisted.toastWarning,
    success: vi.fn(),
  },
}))

vi.mock("../../../App", () => ({ default: hoisted.fakeWKApp }))

vi.mock("../../../Service/Provider", () => ({
  ProviderListener: class {
    notifyListener(): void {}
  },
}))

// UI 组件 stubs —— 防止 test 环境里 require 到 PDF viewer / lottie 等重依赖。
vi.mock("../../QRCodeMy", () => ({ default: () => null }))
vi.mock("../../InputEdit", () => ({ InputEdit: () => null }))
vi.mock("../../ListItem", () => ({ ListItem: () => null, ListItemIcon: () => null }))
vi.mock("../../ListItemAvatar", () => ({ ListItemAvatar: () => null }))
vi.mock("../../SexSelect", () => ({ SexSelect: () => null, Sex: { Male: 1, Female: 0 } }))
vi.mock("../../RealnameVerifiedBadge", () => ({ default: () => null }))
vi.mock("../../../Service/Section", () => ({
  Row: class {
    constructor(public v: unknown) {}
  },
  Section: class {
    constructor(public v: unknown) {}
  },
}))
vi.mock("../../../Service/Context", () => ({
  default: class {},
  FinishButtonContext: class {},
  RouteContextConfig: class {
    constructor(public v: unknown) {}
  },
}))
vi.mock("../../../Service/Convert", () => ({
  Convert: { userToChannelInfo: (r: unknown) => ({ orgData: r }) },
}))
vi.mock("../../../Utils/displayName", () => ({
  isRealnameVerified: (o: unknown) =>
    !!(o as { realname_verified?: boolean })?.realname_verified,
}))

// PersonaSettings —— YUJ-1168 / GH octo-web#46 加的「我的分身」入口。
// MeInfoVM 现在 import 它（vm.tsx:1 增量），链式拉到 APIClient.ts 里的
// `static shared = new APIClient()` 顶层副作用，会调 `axios.interceptors.request.use(...)` —— 而本测试
// 文件早已经把 axios mock 成 `{ default: { post: vi.fn() } }`,没有 interceptors,
// 真实链路加载会抛 "Cannot read properties of undefined (reading 'request')"。
// 直接 stub 掉整个组件即可,本测试只关心 MeInfoVM 本身的实名认证副作用。
vi.mock("../../PersonaSettings", () => ({ default: () => null }))

// 真正要测的 class
import { MeInfoVM } from "../vm"
import { i18n } from "../../../i18n"

describe("MeInfoVM.startRealnameVerify — window.open + return_to 合同", () => {
  const originalLocation = window.location
  const originalOpen = window.open

  beforeEach(() => {
    // Error copy is asserted in Chinese; pin zh-CN (jsdom navigator is en-US).
    i18n.setLocale("zh-CN", { persist: false, notify: false })
    hoisted.apiClientPost.mockReset()
    hoisted.apiClientGet.mockReset()
    hoisted.toastError.mockReset()
    hoisted.toastWarning.mockReset()
    hoisted.fakeWKApp.loginInfo.loginProvider = "xming"
    hoisted.apiClientPost.mockResolvedValue({})
    hoisted.apiClientGet.mockResolvedValue({ realname_verified: false, real_name: "" })
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        origin: "https://web-test.imocto.cn",
        pathname: "/me",
        search: "",
        hash: "",
        href: "https://web-test.imocto.cn/me",
      },
    })
  })

  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation })
    window.open = originalOpen
  })

  it("xming provider → window.open(about:blank) 一次,拿到 mock window 后设置 opener=null + location.href 带 return_to", () => {
    // 新实现先 open('about:blank') 拿窗口引用,再手动 opener=null + location.href 导航。
    // 原因见 vm.tsx 注释 —— `noopener` feature 会让 window.open 返 null,无法区分
    // 「真被拦截」vs「成功打开」,误报 toast。
    const openedMock = {
      opener: {} as unknown, // 非 null, 让测试能验证我们真的把它设成了 null
      location: { href: "" },
    }
    const openSpy = vi.fn().mockReturnValue(openedMock as unknown as Window)
    window.open = openSpy as unknown as typeof window.open

    const vm = new MeInfoVM()
    vm.startRealnameVerify()

    // 1. window.open 只被 "about:blank", "_blank" 调用一次,不再传 noopener feature
    expect(openSpy).toHaveBeenCalledTimes(1)
    const [blankUrl, target, features] = openSpy.mock.calls[0]
    expect(blankUrl).toBe("about:blank")
    expect(target).toBe("_blank")
    expect(features).toBeUndefined()

    // 2. opener 被手动置 null(等价 noopener 安全隔离)
    expect(openedMock.opener).toBeNull()

    // 3. location.href 被赋值为完整 verifyUrl,含 return_to query
    expect(openedMock.location.href).toContain(
      "https://accounts-test.imocto.cn/profile/info?anchor=verification",
    )
    const expectedReturnTo = encodeURIComponent("https://web-test.imocto.cn/me?verified=1")
    expect(openedMock.location.href).toContain(`return_to=${expectedReturnTo}`)
  })

  // Round 1 (Jerry-Xin Crit):return_to 必须保留当前 URL 所有 query 参数,
  // 尤其 sid。登录态按 sid 分桶,丢 sid → IdP 回跳后 App.getSID 读空 bucket →
  // token 拿不到 → 后续 /users/{uid} 刷新无鉴权 → 实名状态读不到。
  //
  // verify URL 现在写到 openedMock.location.href(先 about:blank 再导航),
  // 断言改查 mock window 的 location.href,而不是 window.open 第一实参。
  it("[Crit] return_to 保留现有 sid 参数 + 新增 verified=1", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        origin: "https://web-test.imocto.cn",
        pathname: "/me",
        search: "?sid=abc",
        hash: "",
        href: "https://web-test.imocto.cn/me?sid=abc",
      },
    })
    const openedMock = { opener: {} as unknown, location: { href: "" } }
    const openSpy = vi.fn().mockReturnValue(openedMock as unknown as Window)
    window.open = openSpy as unknown as typeof window.open

    new MeInfoVM().startRealnameVerify()

    expect(openSpy).toHaveBeenCalledTimes(1)
    const url = openedMock.location.href
    // 解回 return_to 参数,独立断言里面既有 sid 又有 verified=1
    const match = String(url).match(/return_to=([^&]+)/)
    expect(match).not.toBeNull()
    const decoded = decodeURIComponent(match![1])
    const decodedUrl = new URL(decoded)
    expect(decodedUrl.pathname).toBe("/me")
    expect(decodedUrl.searchParams.get("sid")).toBe("abc")
    expect(decodedUrl.searchParams.get("verified")).toBe("1")
  })

  it("[Crit] return_to 无 query 时只带 verified=1(单 param)", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        origin: "https://web-test.imocto.cn",
        pathname: "/me",
        search: "",
        hash: "",
        href: "https://web-test.imocto.cn/me",
      },
    })
    const openedMock = { opener: {} as unknown, location: { href: "" } }
    const openSpy = vi.fn().mockReturnValue(openedMock as unknown as Window)
    window.open = openSpy as unknown as typeof window.open

    new MeInfoVM().startRealnameVerify()

    const url = openedMock.location.href
    const match = String(url).match(/return_to=([^&]+)/)
    const decoded = decodeURIComponent(match![1])
    expect(decoded).toBe("https://web-test.imocto.cn/me?verified=1")
  })

  it("[Crit] URL 已有 verified=0 → 被覆盖为 verified=1 而非重复(URLSearchParams.set 语义)", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        origin: "https://web-test.imocto.cn",
        pathname: "/me",
        search: "?verified=0&sid=xyz",
        hash: "",
        href: "https://web-test.imocto.cn/me?verified=0&sid=xyz",
      },
    })
    const openedMock = { opener: {} as unknown, location: { href: "" } }
    const openSpy = vi.fn().mockReturnValue(openedMock as unknown as Window)
    window.open = openSpy as unknown as typeof window.open

    new MeInfoVM().startRealnameVerify()

    const url = openedMock.location.href
    const match = String(url).match(/return_to=([^&]+)/)
    const decoded = decodeURIComponent(match![1])
    const decodedUrl = new URL(decoded)
    expect(decodedUrl.searchParams.get("verified")).toBe("1")
    expect(decodedUrl.searchParams.get("sid")).toBe("xyz")
    // 绝不允许两个 verified 同时存在(防 URLSearchParams.append 误用)
    expect((decodedUrl.search.match(/verified=/g) || []).length).toBe(1)
  })

  it("window.open 返 null(弹窗拦截) → 仅 toast warning,**绝不**走 window.location.href fallback", () => {
    // 新实现在 open 之后 return 掉,不再继续赋 location.href(mock window 根本没拿到)。
    // 这里单独验证 null → 唯一副作用是 toast warning。
    const openSpy = vi.fn().mockReturnValue(null)
    window.open = openSpy as unknown as typeof window.open

    // 监听 window.location.href 赋值 —— 明确禁止这条 fallback 链路。
    const locationAssign = vi.fn()
    Object.defineProperty(window.location, "href", {
      configurable: true,
      get: () => "https://web-test.imocto.cn/me",
      set: locationAssign,
    })

    const vm = new MeInfoVM()
    vm.startRealnameVerify()

    expect(openSpy).toHaveBeenCalledTimes(1)
    // window.open 被以 about:blank 调用,而不是直接塞 verifyUrl
    expect(openSpy.mock.calls[0][0]).toBe("about:blank")
    expect(locationAssign).not.toHaveBeenCalled() // 核心硬约束
    expect(hoisted.toastWarning).toHaveBeenCalledTimes(1) // 弹窗拦截 toast 提示
    expect(hoisted.toastError).not.toHaveBeenCalled()
  })

  // Jerry R3:确认 `noopener` feature 不再被传入,之前这行让成功打开的
  // case 也返 null → 被误判成弹窗被拦截,用户白看 toast。fixture 返回有效 window,
  // 断言 toast 一次都没被调(否则说明 `if (!opened) toast` 又误触)。
  it("成功打开时绝不误报弹窗拦截 toast(noopener feature 回归防线)", () => {
    const openedMock = { opener: {} as unknown, location: { href: "" } }
    const openSpy = vi.fn().mockReturnValue(openedMock as unknown as Window)
    window.open = openSpy as unknown as typeof window.open

    new MeInfoVM().startRealnameVerify()

    expect(openSpy).toHaveBeenCalledTimes(1)
    // 成功打开 → location.href 被设了 → toast 绝不能被触发
    expect(openedMock.location.href).not.toBe("")
    expect(hoisted.toastWarning).not.toHaveBeenCalled()
    expect(hoisted.toastError).not.toHaveBeenCalled()
  })

  // `opened.opener = null` setter 在部分沙箱下可能被 freeze。实现里用
  // try/catch 吞掉 — 这里显式 fixture 验证:即使 opener setter throw,也仍然要
  // 完成 location.href 导航,并且不对用户报错。
  it("opener setter 抛错时,仍然继续 location.href 导航 + 不 toast error", () => {
    const openedMock: { opener: unknown; location: { href: string } } = {
      opener: {},
      location: { href: "" },
    }
    Object.defineProperty(openedMock, "opener", {
      configurable: true,
      get: () => ({}),
      set: () => {
        throw new Error("frozen in sandbox")
      },
    })
    const openSpy = vi.fn().mockReturnValue(openedMock as unknown as Window)
    window.open = openSpy as unknown as typeof window.open

    new MeInfoVM().startRealnameVerify()

    // 导航仍然发生
    expect(openedMock.location.href).toContain("https://accounts-test.imocto.cn/profile/info")
    expect(openedMock.location.href).toContain("return_to=")
    expect(hoisted.toastError).not.toHaveBeenCalled()
    expect(hoisted.toastWarning).not.toHaveBeenCalled()
  })

  it("loginProvider=local → Toast.error,不调 window.open(保留原有行为)", () => {
    hoisted.fakeWKApp.loginInfo.loginProvider = "local"
    const openSpy = vi.fn()
    window.open = openSpy as unknown as typeof window.open

    const vm = new MeInfoVM()
    vm.startRealnameVerify()

    expect(openSpy).not.toHaveBeenCalled()
    expect(hoisted.toastError).toHaveBeenCalledTimes(1)
    expect(hoisted.toastError.mock.calls[0][0]).toMatch(/当前账号不支持/)
  })
})

describe("MeInfoVM.didMount — reloadSelfProfile only (pull-from-idp endpoint decommissioned)", () => {
  const originalLocation = window.location

  beforeEach(() => {
    hoisted.apiClientPost.mockReset()
    hoisted.apiClientGet.mockReset()
    hoisted.apiClientPost.mockResolvedValue({})
    hoisted.apiClientGet.mockResolvedValue({
      realname_verified: false,
      real_name: "",
    })
  })

  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation })
  })

  it("无 ?verified=1 → 仅 reloadSelfProfile,绝不 POST 任何 endpoint(pull-from-idp 已废弃)", async () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        search: "",
        pathname: "/me",
        origin: "https://x",
        hash: "",
        href: "https://x/me",
      },
    })

    const vm = new MeInfoVM()
    vm.didMount()
    // 给 promise 微任务几轮时间把 reloadSelfProfile 跑完
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // didMount 的 reloadSelfProfile 会 GET /users/uid-1
    expect(hoisted.apiClientGet).toHaveBeenCalledWith("users/uid-1")
    // 硬约束:不再对 pull-from-idp 发 POST(dmworkim 侧 endpoint 已废弃)
    const pullCalls = hoisted.apiClientPost.mock.calls.filter(
      (args) => args[0] === "internal/realname/pull-from-idp",
    )
    expect(pullCalls).toHaveLength(0)
    // 也不应调用任何其它 POST(防回归)
    expect(hoisted.apiClientPost).not.toHaveBeenCalled()
  })

  it("?verified=1 → 清除 URL 参数 + reloadSelfProfile,不调 pull-from-idp", async () => {
    const replaceStateSpy = vi.fn()
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        search: "?verified=1",
        pathname: "/me",
        origin: "https://x",
        hash: "",
        href: "https://x/me?verified=1",
      },
    })
    Object.defineProperty(window, "history", {
      configurable: true,
      value: { ...window.history, replaceState: replaceStateSpy },
    })

    const vm = new MeInfoVM()
    vm.didMount()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // URL 清理必须把 ?verified=1 清掉,避免二次进入重复触发
    expect(replaceStateSpy).toHaveBeenCalledTimes(1)
    const [, , newUrl] = replaceStateSpy.mock.calls[0]
    expect(newUrl).not.toContain("verified=1")

    // reloadSelfProfile 一次 GET
    expect(
      hoisted.apiClientGet.mock.calls.filter((args) => args[0] === "users/uid-1"),
    ).toHaveLength(1)

    // 硬约束:回跳路径上也不再 POST pull-from-idp
    const pullCalls = hoisted.apiClientPost.mock.calls.filter(
      (args) => args[0] === "internal/realname/pull-from-idp",
    )
    expect(pullCalls).toHaveLength(0)
  })

  it("?verified=1 回跳保留其他 query 参数(sid 等),只删 verified", async () => {
    const replaceStateSpy = vi.fn()
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        search: "?sid=abc&verified=1",
        pathname: "/me",
        origin: "https://x",
        hash: "",
        href: "https://x/me?sid=abc&verified=1",
      },
    })
    Object.defineProperty(window, "history", {
      configurable: true,
      value: { ...window.history, replaceState: replaceStateSpy },
    })

    const vm = new MeInfoVM()
    vm.didMount()
    await Promise.resolve()

    expect(replaceStateSpy).toHaveBeenCalledTimes(1)
    const [, , newUrl] = replaceStateSpy.mock.calls[0]
    expect(newUrl).toContain("sid=abc")
    expect(newUrl).not.toContain("verified=1")
  })
})
