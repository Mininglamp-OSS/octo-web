const SESSION_SID_KEY = "octo.session.sid";

let memorySid = "";

function randomSid(): string {
  return Math.random().toString(36).slice(-6);
}

function safeSessionStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function safeLocalStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function findReusableStoredSessionSid(store: Pick<Storage, "length" | "key" | "getItem"> | undefined): string {
  if (!store) return "";

  const sessions: { sid: string; uid: string }[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (!key || !key.startsWith("token") || key === "token" || key === "tokenCallback") {
      continue;
    }
    const token = store.getItem(key);
    if (!token) continue;

    const sid = key.slice("token".length);
    if (!sid) continue;
    sessions.push({
      sid,
      uid: store.getItem(`uid${sid}`) || "",
    });
  }

  if (sessions.length === 1) return sessions[0].sid;

  const uid = sessions[0]?.uid;
  if (uid && sessions.every((session) => session.uid === uid)) {
    return sessions[0].sid;
  }

  return "";
}

export function getSidFromSearch(search: string): string {
  const params = new URLSearchParams(search || "");
  return params.get("sid") || "";
}

export function removeSidFromSearch(search: string): string {
  const params = new URLSearchParams(search || "");
  params.delete("sid");
  const next = params.toString();
  return next ? `?${next}` : "";
}

export function removeSidFromPath(path: string): string {
  try {
    const url = new URL(
      path,
      typeof window === "undefined" ? "https://octo.local" : window.location.origin
    );
    url.searchParams.delete("sid");
    return url.pathname + url.search + url.hash;
  } catch {
    return path;
  }
}

export function setSessionSid(sid: string | null | undefined): string {
  const nextSid = sid || "";
  memorySid = nextSid;
  const store = safeSessionStorage();
  if (store) {
    if (nextSid) {
      store.setItem(SESSION_SID_KEY, nextSid);
    } else {
      store.removeItem(SESSION_SID_KEY);
    }
  }
  return nextSid;
}

export function ensureSessionSid(): string {
  const urlSid = typeof window === "undefined" ? "" : getSidFromSearch(window.location.search);
  if (urlSid) return setSessionSid(urlSid);

  const store = safeSessionStorage();
  const storedSid = store?.getItem(SESSION_SID_KEY) || memorySid;
  if (storedSid) return setSessionSid(storedSid);

  const reusableSid = findReusableStoredSessionSid(safeLocalStorage());
  if (reusableSid) return setSessionSid(reusableSid);

  return setSessionSid(randomSid());
}

export function getSessionSid(): string {
  return ensureSessionSid();
}

export function stripSessionSidFromUrl(): boolean {
  if (typeof window === "undefined") return false;
  const search = window.location.search || "";
  if (!getSidFromSearch(search)) return false;

  const nextUrl = window.location.pathname + removeSidFromSearch(search) + window.location.hash;
  window.history.replaceState(window.history.state, document.title, nextUrl);
  return true;
}
