import { Button, Input } from "@octo/ui";
import React, { useState, useRef, useEffect } from "react"
import { Modal } from "@douyinfe/semi-ui";
import { useI18n } from "../../i18n"
import "./index.css"

export interface CreateCategoryModalProps {
    visible: boolean
    onConfirm: (name: string) => Promise<void> | void
    onCancel: () => void
    existingNames?: string[]
}

const CreateCategoryModal: React.FC<CreateCategoryModalProps> = ({
    visible,
    onConfirm,
    onCancel,
    existingNames = [],
}) => {
    const { t } = useI18n()
    const [value, setValue] = useState("")
    const [loading, setLoading] = useState(false)
    const [errorKey, setErrorKey] = useState<string | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (visible) {
            setValue("")
            setErrorKey(null)
            setLoading(false)
            setTimeout(() => inputRef.current?.focus(), 100)
        }
    }, [visible])

    // loading 期间(父层 onConfirm 进行中)不参与重复校验:此时分类可能已建成
    // 并出现在 existingNames 里,但用户输入框里的 value 还没被清空 ——
    // 否则会让"该分组名已存在"在 modal 关掉前闪一下。
    const isDuplicate = !loading && existingNames.includes(value.trim())
    const isEmpty = value.trim() === ""
    const isDisabled = isEmpty || isDuplicate || loading

    const handleConfirm = async () => {
        if (isDisabled) return
        if (isDuplicate) {
            setErrorKey("base.createCategory.error.duplicate")
            return
        }
        setLoading(true)
        setErrorKey(null)
        try {
            await onConfirm(value.trim())
            setValue("")
        } catch {
            setErrorKey("base.createCategory.error.createFailed")
        } finally {
            setLoading(false)
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") handleConfirm()
        if (e.key === "Escape") onCancel()
    }

    return (
        <Modal
            title={t("base.createCategory.title")}
            visible={visible}
            onCancel={onCancel}
            zIndex={9999}
            footer={
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <Button type="tertiary" onClick={onCancel}>{t("base.common.cancel")}</Button>
                    <Button
                        type="primary"
                        disabled={isDisabled}
                        loading={loading}
                        onClick={handleConfirm}
                        style={{ opacity: isDisabled && !loading ? 0.5 : 1 }}
                    >
                        {t("base.common.ok")}
                    </Button>
                </div>
            }
        >
            <div className="wk-create-category-modal__input-wrap">
                <Input
                    ref={inputRef as any}
                    value={value}
                    onChange={(v) => {
                        setValue(v)
                        if (errorKey) setErrorKey(null)
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder={t("base.createCategory.placeholder")}
                    validateStatus={isDuplicate || errorKey ? "error" : undefined}
                />
                {(isDuplicate || errorKey) ? (
                    <div className="wk-create-category-modal__error">
                        {isDuplicate
                            ? t("base.createCategory.error.duplicate")
                            : errorKey
                                ? t(errorKey)
                                : null}
                    </div>
                ) : (
                    <div className="wk-create-category-modal__help">
                        {t("base.createCategory.help")}
                    </div>
                )}
            </div>
        </Modal>
    )
}

export default CreateCategoryModal
