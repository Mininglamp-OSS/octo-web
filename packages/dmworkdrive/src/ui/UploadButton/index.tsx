import React, { useRef } from 'react';
import { useI18n } from '@octo/base';
import { Button } from '@douyinfe/semi-ui';
import { Upload } from 'lucide-react';

export interface UploadButtonProps {
  disabled?: boolean;
  /** Fired with the picked files; the drive page routes them into useUpload. */
  onFiles: (files: FileList) => void;
}

/**
 * File-picker entry for Type-2 uploads.
 *
 * A hidden native <input type="file" multiple> behind a Semi Button — the
 * custom direct-to-storage flow doesn't use Semi Upload's built-in xhr, so a
 * plain input keeps the byte transfer under useUpload's control.
 */
export default function UploadButton({ disabled, onFiles }: UploadButtonProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <Button
        icon={<Upload size={16} />}
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        {t('drive.file.upload')}
      </Button>
      <input
        ref={inputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          const { files } = e.target;
          if (files && files.length) onFiles(files);
          // Reset so picking the same file again re-fires onChange.
          e.target.value = '';
        }}
      />
    </>
  );
}
