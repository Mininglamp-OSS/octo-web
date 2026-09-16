import React from "react"
import ConversationSelect, { type ConversationSelectProps } from "../../Components/ConversationSelect"
import WKModal from "../../Components/WKModal"
import { getForwardSurfacePort } from "./surfaceRegistry"

export function ForwardPickerPresentation({
  visible,
  pickerKey,
  ...props
}: ConversationSelectProps & { visible?: boolean; pickerKey?: number }) {
  const port = getForwardSurfacePort()
  if (port) {
    return visible ? <ConversationSelect key={pickerKey} {...props} surfacePort={port} /> : null
  }
  return (
    <WKModal
      className="wk-base-modal wk-base-modal-forward"
      visible={visible}
      width={625}
      options={{ mask: false }}
      onCancel={props.onCancel}
    >
      <ConversationSelect key={pickerKey} {...props} />
    </WKModal>
  )
}
