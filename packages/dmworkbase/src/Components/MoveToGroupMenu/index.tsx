import React from "react"
import { Dropdown } from "@octo/ui"
import { useI18n } from "../../i18n"
import "./index.css"

export interface Category {
    id: string
    name: string
}

export interface MoveToGroupMenuProps {
    categories: Category[]
    onSelect: (categoryId: string) => void
    onCreateNew: () => void
}

const MoveToGroupMenu: React.FC<MoveToGroupMenuProps> = ({
    categories,
    onSelect,
    onCreateNew,
}) => {
    const { t } = useI18n()
    return (
        <div className="wk-move-to-group-menu">
            <Dropdown.Menu>
                {categories.map((cat) => (
                    <Dropdown.Item
                        key={cat.id}
                        onSelect={() => onSelect(cat.id)}
                    >
                        {cat.name}
                    </Dropdown.Item>
                ))}
                {categories.length > 0 && <Dropdown.Divider />}
                <Dropdown.Item
                    className="wk-move-to-group-menu__create"
                    onSelect={onCreateNew}
                >
                    {t("base.chatSidebar.context.createCategory")}
                </Dropdown.Item>
            </Dropdown.Menu>
        </div>
    )
}

export default MoveToGroupMenu
