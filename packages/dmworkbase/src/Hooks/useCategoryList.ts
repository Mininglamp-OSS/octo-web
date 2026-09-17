import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import WKApp from "../App"
import CategoryService, { CategoryItem } from "../Service/CategoryService"
import { t } from "../i18n"
import { subscribePageActivation } from "../Utils/pageActivation"

export interface UseCategoryListResult {
    categories: CategoryItem[]
    isLoading: boolean
    error: string | null
    reload: () => void
    createCategory: (name: string) => Promise<CategoryItem>
    renameCategory: (categoryId: string, name: string) => Promise<void>
    deleteCategory: (categoryId: string) => Promise<void>
    sortCategories: (categoryIds: string[]) => Promise<void>
    moveGroupToCategory: (groupNo: string, categoryId: string) => Promise<void>
}

export function useCategoryList(): UseCategoryListResult {
    const [categories, setCategories] = useState<CategoryItem[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const spaceId = WKApp.shared.currentSpaceId
    const scope = useMemo(() => ({ active: false }), [spaceId])
    const request = useRef(0)
    const silentRequest = useRef(0)

    const load = useCallback(async (silent = false) => {
        if (!scope.active || !spaceId || WKApp.shared.currentSpaceId !== spaceId) return
        const revision = silent ? request.current : ++request.current
        const silentRevision = silent ? ++silentRequest.current : 0
        const isCurrent = () => scope.active && revision === request.current &&
            (!silent || silentRevision === silentRequest.current) &&
            WKApp.shared.currentSpaceId === spaceId
        if (!silent) {
            setIsLoading(true)
            setError(null)
        }
        try {
            const result = await CategoryService.list(spaceId)
            if (!isCurrent()) return
            if (silent) {
                setIsLoading(false)
                request.current++
            }
            // 后端 PR #1007 起，默认分组有真实 UUID，不再返回 category_id 为 null 的项。
            // 保留所有项，类型守卫在 ConversationListGrouped 的 ValidCategoryItem 处处理。
            setCategories(result)
            setError(null)
        } catch (e: any) {
            if (isCurrent() && !silent) setError(e?.message || t("base.categoryList.loadFailed"))
        } finally {
            if (isCurrent() && !silent) setIsLoading(false)
        }
    }, [spaceId, scope])

    useEffect(() => {
        scope.active = true
        setCategories([])
        setError(null)
        setIsLoading(false)
        void load()
        return () => {
            scope.active = false
            request.current++
        }
    }, [load, scope])

    useEffect(() => subscribePageActivation("chat", () => { void load(true) }), [load])
    const reload = useCallback(() => load(), [load])

    const canApplyMutation = () => {
        if (!scope.active || WKApp.shared.currentSpaceId !== spaceId) return false
        // A snapshot started before the mutation cannot revert its optimistic result.
        request.current++
        setIsLoading(false)
        return true
    }

    const createCategory = async (name: string) => {
        if (!spaceId) throw new Error(t("base.categoryList.noSpaceSelected"))
        const created = await CategoryService.create(spaceId, { name })
        await load()
        return created
    }

    const renameCategory = async (categoryId: string, name: string) => {
        if (!spaceId) throw new Error(t("base.categoryList.noSpaceSelected"))
        await CategoryService.update(spaceId, categoryId, { name })
        if (!canApplyMutation()) return
        setCategories(prev =>
            prev.map(c => c.category_id === categoryId ? { ...c, name } : c)
        )
    }

    const deleteCategory = async (categoryId: string) => {
        if (!spaceId) throw new Error(t("base.categoryList.noSpaceSelected"))
        await CategoryService.delete(spaceId, categoryId)
        if (!canApplyMutation()) return
        setCategories(prev => prev.filter(c => c.category_id !== categoryId))
    }

    const sortCategories = async (categoryIds: string[]) => {
        if (!spaceId) throw new Error(t("base.categoryList.noSpaceSelected"))
        await CategoryService.sort(spaceId, { category_ids: categoryIds })
        if (!canApplyMutation()) return
        // 按新顺序重排本地数据
        setCategories(prev => {
            const map = new Map(prev.map(c => [c.category_id, c]))
            return categoryIds.map(id => map.get(id)).filter(Boolean) as CategoryItem[]
        })
    }

    const moveGroupToCategory = async (groupNo: string, categoryId: string) => {
        await CategoryService.moveGroupToCategory(groupNo, { category_id: categoryId })
        await load()
    }

    return {
        categories,
        isLoading,
        error,
        reload,
        createCategory,
        renameCategory,
        deleteCategory,
        sortCategories,
        moveGroupToCategory,
    }
}
