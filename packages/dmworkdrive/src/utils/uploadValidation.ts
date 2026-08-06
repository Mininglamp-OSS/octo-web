/**
 * Client-side pre-flight validation for uploads. Everything here mirrors a
 * hard rule enforced by the backend, so declining locally saves the round
 * trip (and lets us show a clear message before the file starts uploading).
 */

/** Empty files are rejected server-side (octo-drive blob/service.go: size==0
 *  and octo-server file/api.go: fileSize <= 0). Reject at the boundary. */
export const MIN_UPLOAD_SIZE = 1;

/** Matches octo-server modules/file/const.go MaxFileSize (100 MB). */
export const MAX_UPLOAD_SIZE = 100 * 1024 * 1024;

export type UploadRejectReason = 'empty' | 'tooLarge';

export interface UploadRejection {
  file: File;
  reason: UploadRejectReason;
}

export interface UploadValidationResult {
  accepted: File[];
  rejected: UploadRejection[];
}

/**
 * Split an incoming FileList / File[] into accepted uploads and rejections
 * with a reason code. Callers translate the reason into i18n text.
 */
export function validateUploads(files: FileList | File[]): UploadValidationResult {
  const accepted: File[] = [];
  const rejected: UploadRejection[] = [];
  for (const file of Array.from(files)) {
    if (file.size < MIN_UPLOAD_SIZE) {
      rejected.push({ file, reason: 'empty' });
      continue;
    }
    if (file.size > MAX_UPLOAD_SIZE) {
      rejected.push({ file, reason: 'tooLarge' });
      continue;
    }
    accepted.push(file);
  }
  return { accepted, rejected };
}
