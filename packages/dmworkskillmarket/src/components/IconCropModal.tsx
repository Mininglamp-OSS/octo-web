import { Button, Modal as OctoModal } from "@octo/ui";
import React, { useRef, useState } from "react";
import AvatarEditor from "react-avatar-editor";
import { t, useI18n } from "@octo/base";

interface IconCropModalProps {
  visible: boolean;
  file: File | null;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}

export default function IconCropModal({ visible, file, onCancel, onConfirm }: IconCropModalProps) {
  useI18n();
  const editorRef = useRef<AvatarEditor | null>(null);
  const [scale, setScale] = useState(1.2);

  function handleSave() {
    const canvas = editorRef.current?.getImageScaledToCanvas();
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (blob) onConfirm(blob);
    }, "image/png");
  }

  return (
    <OctoModal
      title={t("skillMarket.crop.title")}
      visible={visible}
      onCancel={onCancel}
      width={460}
      zIndex={1100}
      className="skill-market-crop-modal"
      closeLabel={t("skillMarket.common.close")}
      footer={
        <div className="skill-market-crop-modal__footer">
          <Button variant="secondary" onClick={onCancel}>{t("skillMarket.common.cancel")}</Button>
          <Button variant="solid" onClick={handleSave}>{t("skillMarket.common.confirm")}</Button>
        </div>
      }
    >
      <div className="skill-market-crop-editor">
        {file && (
          <>
            <AvatarEditor
              ref={editorRef}
              image={file}
              width={200}
              height={200}
              border={40}
              borderRadius={16}
              color={[0, 0, 0, 0.4]}
              scale={scale}
              rotate={0}
            />
            <label className="skill-market-crop-scale">
              <span>{t("skillMarket.crop.scale")}</span>
              <input
                type="range"
                min="1"
                max="3"
                step="0.05"
                value={scale}
                onChange={(e) => setScale(Number(e.target.value))}
              />
            </label>
          </>
        )}
      </div>
    </OctoModal>
  );
}
