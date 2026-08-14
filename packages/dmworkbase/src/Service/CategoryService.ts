import APIClient from "./APIClient"
import { apiPath } from "./apiPath"

export interface CategoryGroup {
    group_no: string
    name: string
    category_sort: number
}

export interface CategoryItem {
    category_id: string | null
    name: string
    sort: number
    groups: CategoryGroup[]
    /** 是否为默认分组（后端 PR #1007 起，默认分组有真实 UUID，通过此字段区分） */
    is_default?: boolean
}

export interface CreateCategoryReq {
    name: string
}

export interface UpdateCategoryReq {
    name: string
}

export interface SortCategoriesReq {
    category_ids: string[]
}

export interface MoveGroupToCategoryReq {
    category_id: string  // 目标分组 ID；移出分组时传默认分组的真实 UUID（后端 PR #1007 起不再接受空字符串）
}

const CategoryService = {
    /** 获取分组列表（含各分组下群聊） */
    list(spaceId: string): Promise<CategoryItem[]> {
        return APIClient.shared.get<CategoryItem[]>(`/spaces/${spaceId}/categories`)
    },

    /** 创建分组 */
    create(spaceId: string, req: CreateCategoryReq): Promise<CategoryItem> {
        return APIClient.shared.post(apiPath`/spaces/${spaceId}/categories`, req)
    },

    /** 重命名分组 */
    update(spaceId: string, categoryId: string, req: UpdateCategoryReq): Promise<void> {
        return APIClient.shared.put(apiPath`/spaces/${spaceId}/categories/${categoryId}`, req)
    },

    /** 删除分组 */
    delete(spaceId: string, categoryId: string): Promise<void> {
        return APIClient.shared.delete(apiPath`/spaces/${spaceId}/categories/${categoryId}`)
    },

    /** 批量排序分组 */
    sort(spaceId: string, req: SortCategoriesReq): Promise<void> {
        return APIClient.shared.put(apiPath`/spaces/${spaceId}/categories/sort`, req)
    },

    /** 移动群聊到分组 */
    moveGroupToCategory(groupNo: string, req: MoveGroupToCategoryReq): Promise<void> {
        return APIClient.shared.put(apiPath`/groups/${groupNo}/category`, req)
    },
}

export default CategoryService
