const WPS_EXTENSION_MAP: Readonly<Record<string, string>> = {
  wps: "docx",
  et: "xlsx",
  dps: "pptx",
};

export const getFileViewerFilename = (filename: string): string => {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return filename;

  const extension = filename.slice(dot + 1).toLowerCase();
  const mappedExtension = WPS_EXTENSION_MAP[extension];
  return mappedExtension
    ? `${filename.slice(0, dot + 1)}${mappedExtension}`
    : filename;
};
