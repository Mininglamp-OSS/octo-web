import React, { forwardRef } from "react"
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react"
import {
  Button,
  Input,
  Modal,
  modalConfirm,
  type ButtonProps,
  type InputProps,
  type ModalConfirmHandle,
  type ModalConfirmOptions,
  type ModalSize,
} from "@octo/ui"
import { t } from "../../i18n"

export type WKButtonVariant = "primary" | "secondary" | "ghost" | "danger"
export type WKButtonSize = "md" | "sm"

export interface WKButtonProps extends Omit<ButtonProps, "htmlType" | "size" | "theme" | "type" | "variant"> {
  /** @deprecated Use @octo/ui Button variant. */
  variant?: WKButtonVariant
  /** @deprecated Use @octo/ui Button size. */
  size?: WKButtonSize
  type?: ButtonHTMLAttributes<HTMLButtonElement>["type"]
}

const wkButtonVariantMap: Record<WKButtonVariant, ButtonProps["variant"]> = {
  primary: "solid",
  secondary: "secondary",
  ghost: "text",
  danger: "danger",
}

const wkButtonSizeMap: Record<WKButtonSize, ButtonProps["size"]> = {
  md: "md",
  sm: "sm",
}

/**
 * @deprecated Import Button from @octo/ui instead.
 */
export const WKButton = forwardRef<HTMLButtonElement, WKButtonProps>(function WKButton(
  {
    variant = "secondary",
    size = "md",
    type = "button",
    ...rest
  },
  ref,
) {
  return (
    <Button
      {...rest}
      ref={ref}
      htmlType={type}
      size={wkButtonSizeMap[size]}
      variant={wkButtonVariantMap[variant]}
    />
  )
})

export type WKInputSize = "sm" | "md" | "lg"

export interface WKInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "prefix" | "size" | "value"> {
  /** @deprecated Use @octo/ui Input size. */
  size?: WKInputSize
  value?: string
  onChange?: (value: string) => void
  onEnterPress?: () => void
  error?: boolean
  prefix?: ReactNode
  suffix?: ReactNode
}

/**
 * @deprecated Import Input from @octo/ui instead.
 */
export const WKInput = forwardRef<HTMLInputElement, WKInputProps>(function WKInput(
  {
    onChange,
    onEnterPress,
    readOnly,
    size = "md",
    ...rest
  },
  ref,
) {
  return (
    <Input
      {...(rest as Omit<InputProps, "onChange" | "onEnterPress" | "readonly" | "size">)}
      ref={ref}
      readonly={readOnly}
      size={size}
      onChange={(value) => onChange?.(String(value))}
      onEnterPress={() => onEnterPress?.()}
    />
  )
})

export type WKModalSize = "md" | "lg" | "full"

export interface WKModalFooterConfig {
  okText?: string
  cancelText?: string
  isCancelDisabled?: boolean
  isOkLoading?: boolean
  isDanger?: boolean
  onOk?: () => void | Promise<void>
}

export interface WKModalProps {
  visible: boolean
  onCancel: () => void
  title?: ReactNode
  /** @deprecated Use @octo/ui Modal size. */
  size?: WKModalSize
  width?: number | string
  footer?: ReactNode
  footerConfig?: WKModalFooterConfig
  options?: {
    closable?: boolean
    maskClosable?: boolean
    mask?: boolean
    closeOnEsc?: boolean
  }
  style?: React.CSSProperties
  zIndex?: number
  bodyStyle?: React.CSSProperties
  header?: ReactNode
  className?: string
  children?: ReactNode
}

const wkModalSizeMap: Record<WKModalSize, ModalSize> = {
  md: "default",
  lg: "wide",
  full: "fullscreen",
}

function mapWKFooterConfig(config: WKModalFooterConfig | undefined): import("@octo/ui").ModalFooterConfig | undefined {
  if (!config?.onOk) return undefined
  return {
    cancelText: config.cancelText ?? t("base.common.cancel"),
    isCancelDisabled: config.isCancelDisabled,
    isDanger: config.isDanger,
    isOkLoading: config.isOkLoading,
    okText: config.okText ?? t("base.common.ok"),
    onOk: config.onOk,
  }
}

/**
 * @deprecated Import Modal from @octo/ui instead.
 */
export function WKModal({
  visible,
  onCancel,
  size = "md",
  footerConfig,
  options,
  ...rest
}: WKModalProps) {
  return (
    <Modal
      {...rest}
      open={visible}
      closeLabel={t("base.common.close")}
      closable={options?.closable}
      closeOnEsc={options?.closeOnEsc}
      footerConfig={mapWKFooterConfig(footerConfig)}
      mask={options?.mask}
      maskClosable={options?.maskClosable}
      size={wkModalSizeMap[size]}
      onClose={onCancel}
    />
  )
}

export type WKConfirmProps = ModalConfirmOptions & Record<string, unknown>

/**
 * @deprecated Import modalConfirm from @octo/ui instead.
 */
export function wkConfirm(props: WKConfirmProps): ModalConfirmHandle {
  const { cancelText, okText, onCancel, onOk, ...rest } = props
  return modalConfirm({
    ...(rest as Omit<ModalConfirmOptions, "cancelText" | "okText" | "onCancel" | "onOk">),
    cancelText: cancelText ?? t("base.common.cancel"),
    okText: okText ?? t("base.common.ok"),
    onCancel,
    onOk,
  })
}

export type {
  ModalConfirmHandle,
  ModalConfirmOptions,
}
