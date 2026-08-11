const OCTO_CONFIG = {
  appId: "com.mininglamp.octo.web",
  name: "OCTO",
  updateUrl: 'https://api.example.com/'
};

// The Electron main process must get the OIDC API origin from build/runtime
// configuration, never from an IPC argument supplied by the renderer.
export const OIDC_API_ORIGIN = (() => {
  const raw = process.env.VITE_API_URL;
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.origin
      : undefined;
  } catch {
    return undefined;
  }
})();

export default OCTO_CONFIG;
