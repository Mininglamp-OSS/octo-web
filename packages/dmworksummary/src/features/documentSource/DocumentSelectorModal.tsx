import React from "react";
import type { DocSearchItem } from "@octo/base";
import { useDocumentSearch } from "../../bridge/documentSource/useDocumentSearch";
import DocumentSelector from "../../ui/DocumentSelector";

interface DocumentSelectorModalProps {
  visible: boolean;
  selected: DocSearchItem[];
  maxSelect: number;
  onConfirm: (selected: DocSearchItem[]) => void;
  onCancel: () => void;
}

const DocumentSelectorModal: React.FC<DocumentSelectorModalProps> = (props) => {
  const model = useDocumentSearch({
    visible: props.visible,
    selected: props.selected,
    maxSelect: props.maxSelect,
  });

  if (!props.visible) return null;

  return (
    <DocumentSelector
      visible={props.visible}
      state={model.state}
      actions={{
        ...model.actions,
        onConfirm: () => props.onConfirm(model.state.selected),
        onCancel: props.onCancel,
      }}
    />
  );
};

export default DocumentSelectorModal;
