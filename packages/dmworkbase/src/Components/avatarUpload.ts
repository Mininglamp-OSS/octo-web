export const AVATAR_FILE_SIZE_LIMIT_MB = 5;
export const AVATAR_FILE_SIZE_LIMIT_BYTES = AVATAR_FILE_SIZE_LIMIT_MB * 1024 * 1024;

export function isGifImageFile(file?: File | null): boolean {
    if (!file) {
        return false;
    }
    const type = file.type.toLowerCase();
    if (type) {
        return type === "image/gif";
    }
    return /\.gif$/i.test(file.name);
}

export function isAvatarFileTooLarge(file?: File | null): boolean {
    return !!file && file.size > AVATAR_FILE_SIZE_LIMIT_BYTES;
}

export function canvasToPngFile(canvas: HTMLCanvasElement, fileName: string): Promise<File> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob: Blob | null) => {
            if (!blob) {
                reject(new Error("Failed to process image"));
                return;
            }
            resolve(new File([blob], fileName, {
                type: "image/png"
            }));
        }, "image/png");
    });
}
