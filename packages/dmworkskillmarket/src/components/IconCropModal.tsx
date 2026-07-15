import React, { useRef, useState } from "react";
import AvatarEditor from "react-avatar-editor";
import { WKButton, WKModal } from "@octo/base";

interface IconCropModalProps {
  visible: boolean;
  file: File | null;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}

export default function IconCropModal({ visible, file, onCancel, onConfirm }: IconCropModalProps) {
  const editorRef = useRef<AvatarEditor | null>(null);
  const [scale, setScale] = useState(1.2);

  function handleSave() {
    const canvas = editorRef.current?.getImageScaledToCanvas();
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (blob) onConfirm(blob);
    }, "image/png");
  }

  if (!file) return null;

  return (
    <WKModal
      title="裁剪图标"
      visible={visible}
      onCancel={onCancel}
      className="skill-market-crop-modal"
      footer={
        <div className="skill-market-crop-modal__footer">
          <WKButton variant="secondary" onClick={onCancel}>取消</WKButton>
          <WKButton variant="primary" onClick={handleSave}>确定</WKButton>
        </div>
      }
    >
      <div className="skill-market-crop-editor">
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
          <span>缩放</span>
          <input
            type="range"
            min="1"
            max="3"
            step="0.05"
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
          />
        </label>
      </div>
    </WKModal>
  );
}
