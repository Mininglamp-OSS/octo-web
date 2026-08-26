import { describe, it, expect } from "vitest"
import { resolveRealnameVerifyUrl } from "../realnameVerifyUrl"
import type { OidcProviderConfig } from "../../../Service/OidcConfig"

/**
 * Web 端「去认证」入口 URL 解析器单测。
 *
 * 把 IdP verification URL 的拼接逻辑从 vm.tsx 里抽出来, 用纯函数锁住行为合约:
 *   1. provider 有 account_url → 拼 `${accountUrl}/profile/info?anchor=verification&return_to=<encoded>`
 *   2. provider 有但 account_url 缺失 → no_account_url（vm.tsx 会 toast 不跳）
 *   3. loginProvider=local / 空 → local_account / no_login_provider（不跳）
 *   4. provider id 在 oidcProviders 里查不到 → no_account_url（不跳）
 *
 * return_to 必须 encodeURIComponent,且必须出现在拼好的 URL 尾部;
 * 任何把 prod 域 / test 域硬编码兜底或省略 return_to 的 regression 都应该挂掉这个 suite。
 */

const idpProdProvider: OidcProviderConfig = {
  id: "xming",
  name: "xming",
  authorizePath: "/auth/oidc/xming/authorize",
  accountUrl: "https://accounts.example.com",
}

const idpTestProvider: OidcProviderConfig = {
  id: "xming",
  name: "xming",
  authorizePath: "/auth/oidc/xming/authorize",
  accountUrl: "https://accounts-test.example.com",
}

const octoProvider: OidcProviderConfig = {
  id: "octo",
  name: "octo",
  authorizePath: "/auth/oidc/octo/authorize",
  accountUrl: "https://accounts-octo.example/",
}

// 和 MeInfoVM.startRealnameVerify() 实际会传的形态一致 —— 典型的
// `${window.location.origin}${window.location.pathname}?verified=1`
// 做 test fixture。
const SAMPLE_RETURN_TO = "https://web-test.example.com/me?verified=1"
const EXPECTED_ENCODED_RETURN_TO = encodeURIComponent(SAMPLE_RETURN_TO)

describe("resolveRealnameVerifyUrl", () => {
  it("returns the prod IdP verify URL with encoded return_to when provider matches prod account_url", () => {
    const res = resolveRealnameVerifyUrl("xming", [idpProdProvider], SAMPLE_RETURN_TO)
    expect(res).toEqual({
      ok: true,
      url: `https://accounts.example.com/profile/info?anchor=verification&return_to=${EXPECTED_ENCODED_RETURN_TO}`,
    })
  })

  it("returns the test IdP verify URL with encoded return_to (im-test)", () => {
    const res = resolveRealnameVerifyUrl("xming", [idpTestProvider], SAMPLE_RETURN_TO)
    expect(res).toEqual({
      ok: true,
      url: `https://accounts-test.example.com/profile/info?anchor=verification&return_to=${EXPECTED_ENCODED_RETURN_TO}`,
    })
  })

  it("strips trailing slashes on accountUrl to avoid `//profile/...` protocol-relative leak", () => {
    const res = resolveRealnameVerifyUrl("octo", [octoProvider], SAMPLE_RETURN_TO)
    expect(res).toEqual({
      ok: true,
      url: `https://accounts-octo.example/profile/info?anchor=verification&return_to=${EXPECTED_ENCODED_RETURN_TO}`,
    })
  })

  it("encodeURIComponent escapes reserved chars in return_to (防 query pollution)", () => {
    // 模拟真实场景:return_to 里带 &、=、? —— 不 encode 直接拼会让 IdP 把下游
    // state 参数切断,302 回来时 ?verified=1 丢失。encodeURIComponent 必须生效。
    const malicious = "https://web-test.example.com/me?verified=1&next=/friends&evil=1"
    const res = resolveRealnameVerifyUrl("xming", [idpProdProvider], malicious)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    // 拼好的 URL 里必须出现 encode 过的形态,不出现原始 &next=
    expect(res.url).toContain(`return_to=${encodeURIComponent(malicious)}`)
    expect(res.url).not.toContain("&next=/friends")
  })

  it("returns no_account_url when the matched provider has no accountUrl (legacy appconfig, absent account_url)", () => {
    const provider: OidcProviderConfig = {
      id: "xming",
      name: "xming",
      authorizePath: "/auth/oidc/xming/authorize",
      // accountUrl intentionally omitted
    }
    const res = resolveRealnameVerifyUrl("xming", [provider], SAMPLE_RETURN_TO)
    expect(res).toEqual({ ok: false, reason: "no_account_url" })
  })

  it("returns local_account when loginProvider === 'local' (behaviour preserved)", () => {
    const res = resolveRealnameVerifyUrl("local", [idpProdProvider], SAMPLE_RETURN_TO)
    expect(res).toEqual({ ok: false, reason: "local_account" })
  })

  it("returns no_login_provider when loginProvider is an empty string", () => {
    const res = resolveRealnameVerifyUrl("", [idpProdProvider], SAMPLE_RETURN_TO)
    expect(res).toEqual({ ok: false, reason: "no_login_provider" })
  })

  it("returns no_login_provider when loginProvider is undefined", () => {
    const res = resolveRealnameVerifyUrl(undefined, [idpProdProvider], SAMPLE_RETURN_TO)
    expect(res).toEqual({ ok: false, reason: "no_login_provider" })
  })

  it("returns no_account_url when provider id does not match anything in oidcProviders", () => {
    // 用户登录用的 provider `xming` 被后端下掉了（只剩 octo）—— 不能回退到
    // 随便一个 provider 的 account_url, 这会把用户甩到错的账户中心域名。
    const res = resolveRealnameVerifyUrl("xming", [octoProvider], SAMPLE_RETURN_TO)
    expect(res).toEqual({ ok: false, reason: "no_account_url" })
  })

  it("returns no_account_url when oidcProviders is empty", () => {
    const res = resolveRealnameVerifyUrl("xming", [], SAMPLE_RETURN_TO)
    expect(res).toEqual({ ok: false, reason: "no_account_url" })
  })

  it("treats a null/undefined oidcProviders array as empty (no_account_url)", () => {
    // 冷启动 appconfig 未到时 WKApp.remoteConfig.oidcProviders 可能还是
    // 默认值 [], 但防御 null/undefined 传入同样走 no_account_url 分支。
    expect(resolveRealnameVerifyUrl("xming", undefined, SAMPLE_RETURN_TO)).toEqual({
      ok: false,
      reason: "no_account_url",
    })
    expect(resolveRealnameVerifyUrl("xming", null, SAMPLE_RETURN_TO)).toEqual({
      ok: false,
      reason: "no_account_url",
    })
  })

  // Jerry R3 non-blocking suggestion promoted to strict contract:
  // 空 returnTo 不再静默拼 `return_to=`,直接 throw。调用方本地就能看到 bug,
  // 不等生产里用户回不来才发现。
  describe("empty returnTo throws", () => {
    it("throws when returnTo is an empty string", () => {
      expect(() =>
        resolveRealnameVerifyUrl("xming", [idpProdProvider], ""),
      ).toThrow(/returnTo is required/)
    })

    it("throws when returnTo is undefined (bypass TS via cast)", () => {
      expect(() =>
        resolveRealnameVerifyUrl(
          "xming",
          [idpProdProvider],
          undefined as unknown as string,
        ),
      ).toThrow(/returnTo is required/)
    })

    it("throws when returnTo is null (bypass TS via cast)", () => {
      expect(() =>
        resolveRealnameVerifyUrl(
          "xming",
          [idpProdProvider],
          null as unknown as string,
        ),
      ).toThrow(/returnTo is required/)
    })

    it("throws *before* provider branch checks (fail-fast on programming error)", () => {
      // loginProvider=local 一般会走 local_account 分支,但 returnTo 为空时
      // 应在 provider 判断之前就抛 —— returnTo 是调用方合约错,优先级最高。
      expect(() =>
        resolveRealnameVerifyUrl("local", [idpProdProvider], ""),
      ).toThrow(/returnTo is required/)
    })
  })
})
