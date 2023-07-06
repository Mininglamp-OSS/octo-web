

export default class StorageService {
    private constructor() {
    }
    public static shared = new StorageService()

    setItem(key:string,value:string) {
        localStorage.setItem(key, value)
    }

    getItem(key:string) {
        return localStorage.getItem(key)
    }

    removeItem(key:string) {
        localStorage.removeItem(key)
    }
}