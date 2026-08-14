// 白名单：登录态相关 key 前缀，需要跨 tab 共享
// LoginInfo.load() may restore the token from localStorage after a desktop
// renderer gets a fresh sessionStorage.  Keep every field that is needed to
// identify that restored session in the same bucket; otherwise a freshly
// started Electron/Tauri window sees a token but loses device_flag and
// triggers the desktop migration again on every launch.
const CROSS_TAB_KEYS = [
    "token",
    "uid",
    "short_no",
    "app_id",
    "name",
    "role",
    "is_work",
    "sex",
    "login_provider",
    "device_flag",
];

function isCrossTab(key: string): boolean {
    return CROSS_TAB_KEYS.some(prefix => key.startsWith(prefix));
}

export default class StorageService {
    private constructor() {
    }
    public static shared = new StorageService()

    setItem(key: string, value: string) {
        sessionStorage.setItem(key, value);
        if (isCrossTab(key)) {
            localStorage.setItem(key, value);
        }
    }

    getItem(key: string): string | null {
        const s = sessionStorage.getItem(key);
        if (s !== null) return s;
        return isCrossTab(key) ? localStorage.getItem(key) : null;
    }

    removeItem(key: string) {
        sessionStorage.removeItem(key);
        if (isCrossTab(key)) {
            localStorage.removeItem(key);
        }
    }

    /**
     * Bookkeeping which must survive a renderer/session restart, but must not
     * be copied into another tab's active login session.
     */
    setPersistentItem(key: string, value: string) {
        try {
            localStorage.setItem(key, value);
        } catch {
            // Storage can be unavailable in private/file contexts.
        }
    }

    getPersistentItem(key: string): string | null {
        try {
            return localStorage.getItem(key);
        } catch {
            return null;
        }
    }

    removePersistentItem(key: string) {
        try {
            localStorage.removeItem(key);
        } catch {
            // Storage can be unavailable in private/file contexts.
        }
    }
}
