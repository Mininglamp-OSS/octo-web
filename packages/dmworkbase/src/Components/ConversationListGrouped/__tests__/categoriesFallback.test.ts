import { describe, expect, it } from "vitest"
import {
    computeEffectiveCategories,
    isVirtualCategory,
    VIRTUAL_DEFAULT_CATEGORY_ID,
    type ValidCategoryItem,
} from "../categoriesFallback"

// ─────────────────────────────────────────────────────────────────
// 回归测试：新用户被邀请入群后群聊 tab 显示空状态（PR #1057 修复）
//
// 根因：ConversationListGrouped 向 ConversationListWithCategory 传入
// categories prop 时，computeEffectiveCategories([]) 总会注入虚拟默认分组，
// 导致 categories.length === 0 分支永远不触发，hasNoGroups 被绕过。
//
// 修复：categories=[] && groupConversations=[] 时传 []（触发空状态）；
//       categories=[] 但有群聊时传 categoriesForView（虚拟兜底，正常渲染）。
// ─────────────────────────────────────────────────────────────────
describe("ConversationListGrouped categories prop 条件分支（回归 PR #1057）", () => {
    it("categories=[] 且 groupConversations=[] → 应传 [] 以触发空状态", () => {
        const categories: ValidCategoryItem[] = []
        const groupConversations: unknown[] = []

        // 模拟 ConversationListGrouped 的条件：
        const categoriesForView = computeEffectiveCategories(categories)
        const passedCategories =
            categories.length === 0 && groupConversations.length === 0
                ? []
                : categoriesForView

        // 必须传 []，让 ConversationListWithCategory 进入 hasNoGroups 分支
        expect(passedCategories).toHaveLength(0)
    })

    it("categories=[] 但 groupConversations 有数据 → 应传虚拟默认分组，正常渲染群聊", () => {
        const categories: ValidCategoryItem[] = []
        const groupConversations = [{ channel: { channelID: "g1" } }] // 被邀请入的群

        const categoriesForView = computeEffectiveCategories(categories)
        const passedCategories =
            categories.length === 0 && groupConversations.length === 0
                ? []
                : categoriesForView

        // 必须传虚拟默认分组，让群聊正常渲染而非空状态
        expect(passedCategories).toHaveLength(1)
        expect(isVirtualCategory(passedCategories[0].category_id)).toBe(true)
    })

    it("categories 有数据 → 直接走原 categoriesForView，与 groupConversations 无关", () => {
        const categories: ValidCategoryItem[] = [{
            category_id: "real-uuid-1234",
            name: "工作",
            sort: 0,
            groups: [{ group_no: "g1", name: "A", category_sort: 0 }],
            is_default: false,
        }]
        const groupConversations = [{ channel: { channelID: "g1" } }]

        const categoriesForView = computeEffectiveCategories(categories)
        const passedCategories =
            categories.length === 0 && groupConversations.length === 0
                ? []
                : categoriesForView

        expect(passedCategories).toBe(categoriesForView)
        expect(passedCategories).toHaveLength(1)
        expect(isVirtualCategory(passedCategories[0].category_id)).toBe(false)
    })
})

describe("isVirtualCategory", () => {
    it("识别虚拟默认分组的 category_id 前缀", () => {
        expect(isVirtualCategory(VIRTUAL_DEFAULT_CATEGORY_ID)).toBe(true)
        expect(isVirtualCategory(`${VIRTUAL_DEFAULT_CATEGORY_ID}-xx`)).toBe(true)
    })

    it("后端真实 UUID 不会被识别为虚拟", () => {
        expect(isVirtualCategory("3d2a9f4c-5b5f-4b3f-9c2a-0a7f2d1b4e12")).toBe(false)
        expect(isVirtualCategory("default")).toBe(false)
        expect(isVirtualCategory(null)).toBe(false)
        expect(isVirtualCategory(undefined)).toBe(false)
        expect(isVirtualCategory("")).toBe(false)
    })
})

describe("computeEffectiveCategories", () => {
    it("场景 1: categories=[] 时兜底一个虚拟默认分组", () => {
        const result = computeEffectiveCategories([])

        expect(result).toHaveLength(1)
        const [virtualCat] = result
        expect(virtualCat.category_id).toBe(VIRTUAL_DEFAULT_CATEGORY_ID)
        expect(virtualCat.is_default).toBe(true)
        expect(virtualCat.name).toBe("分组")
        expect(virtualCat.groups).toEqual([])
        expect(isVirtualCategory(virtualCat.category_id)).toBe(true)
    })

    it("场景 2: 后端返回真 categories 时走原逻辑，不注入虚拟分组", () => {
        const real: ValidCategoryItem[] = [
            {
                category_id: "3d2a9f4c-5b5f-4b3f-9c2a-0a7f2d1b4e12",
                name: "默认分组",
                sort: 0,
                groups: [],
                is_default: true,
            },
            {
                category_id: "7fa8b2c1-1111-2222-3333-444455556666",
                name: "工作",
                sort: 1,
                groups: [{ group_no: "g1", name: "A", category_sort: 0 }],
            },
        ]

        const result = computeEffectiveCategories(real)

        // 直接返回原数组（引用相等），确保不做多余拷贝
        expect(result).toBe(real)
        // 无虚拟分组渗入
        expect(result.some(c => isVirtualCategory(c.category_id))).toBe(false)
    })
})
