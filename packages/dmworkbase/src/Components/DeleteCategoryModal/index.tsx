import { Button } from "@octo/ui";
import React, { useState } from "react"
import { Modal } from "@douyinfe/semi-ui";
import { useI18n } from "../../i18n"

export interface DeleteCategoryModalProps {
    visible: boolean
    categoryName: string
    groupCount: number
    onConfirm: () => Promise<void> | void
    onCancel: () => void
}

const DeleteCategoryModal: React.FC<DeleteCategoryModalProps> = ({
    visible,
    categoryName,
    groupCount,
    onConfirm,
    onCancel,
}) => {
    const { t } = useI18n()
    const [loading, setLoading] = useState(false)

    const handleConfirm = async () => {
        setLoading(true)
        try {
            await onConfirm()
        } finally {
            setLoading(false)
        }
    }

    return (
        <Modal
            title={t("base.deleteCategory.title", { values: { name: categoryName } })}
            visible={visible}
            onCancel={onCancel}
            zIndex={9999}
            footer={
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <Button onClick={onCancel}>{t("base.common.cancel")}</Button>
                    <Button
                        type="danger"
                        loading={loading}
                        onClick={handleConfirm}
                    >
                        {t("base.deleteCategory.confirm")}
                    </Button>
                </div>
            }
        >
            <p style={{ margin: 0, color: "var(--wk-text-secondary)", fontSize: "var(--wk-text-size-base)", lineHeight: 1.6 }}>
                {t("base.deleteCategory.descriptionBefore")} <strong>{groupCount}</strong> {t("base.deleteCategory.descriptionAfter")}
            </p>
        </Modal>
    )
}

export default DeleteCategoryModal
