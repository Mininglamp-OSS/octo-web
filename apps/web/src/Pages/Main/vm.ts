import { WKApp } from "@tsdaodao/base";
import { Menus } from "@tsdaodao/base";
import { ProviderListener } from "@tsdaodao/base";

export default class MainVM extends ProviderListener{

    private _currentMenus?:Menus
    private _settingSelected!:boolean

    private _historyRoutePaths:string[] = []

    private _showNewVersion!:boolean 

    private _hasNewVersion!:boolean // 是否有新版本

    lastVersionInfo?:VersionInfo // 最新版本信息

    private _showMeInfo:boolean // 是否显示我的信息

    set showNewVersion(v:boolean) {
        this._showNewVersion = v
        this.notifyListener()
    }

    get showNewVersion() {
        return this._showNewVersion
    }

    set hasNewVersion(v:boolean) {
        this._hasNewVersion = v
        this.notifyListener()
    }

    get hasNewVersion() {
        return this._hasNewVersion
    }

    get showMeInfo() {
        return this._showMeInfo
    }

    set showMeInfo(v:boolean) {
        this._showMeInfo = v
        this.notifyListener()
    }

    didMount(): void {
        if(WKApp.route.currentPath) {
            for (const menus of this.menusList) {
                if(menus.routePath === WKApp.route.currentPath) {
                    this.currentMenus = menus
                    break
                }
            }
        }
        this.requestVersionCheck().then((data)=>{
            console.log("data--->",data)
            const version = data.app_version
            if(!version) {
                this.hasNewVersion = false
            }else {
                this.lastVersionInfo = {
                    appVersion: version,
                    updateDesc: data.update_desc
                }
                if(version !== WKApp.config.appVersion) {
                    this.hasNewVersion = true
                }else {
                    this.hasNewVersion = false
                }
            }
            this.notifyListener()
        })
    }

    //检测最新版本
    requestVersionCheck() {
       return WKApp.apiClient.get(`common/appversion/web/${WKApp.config.appVersion}`)

    }



    get menusList() {
        return WKApp.menus.menusList()
    }

    get currentMenus() :Menus | undefined {
        return this._currentMenus
    }

    get historyRoutePaths() {
        return this._historyRoutePaths
    }
    set currentMenus(menus:Menus|undefined) {
        this._currentMenus = menus
        if(menus) {
           if( this._historyRoutePaths.indexOf(menus.routePath) === -1) {
            this._historyRoutePaths.push(menus.routePath)
           }
        }
        this.notifyListener()
    }
    get settingSelected() {
        return this._settingSelected
    }

    set settingSelected(settingSelected:boolean) {
        this._settingSelected = settingSelected
        this.notifyListener()
    }
}

export class VersionInfo {
    appVersion!:string // 版本信息
    updateDesc!:string // 更新描述
}