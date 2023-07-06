import { WKApp, WKLayout, Provider } from "@tsdaodao/base";
import React, { Component } from "react";
import "./index.css"
import MainVM from "./vm";
import { TabNormalScreen } from "./tab_normal_screen";


export interface MainContentLeftProps {
    vm: MainVM
}

export interface MainContentLeftState {
}
export class MainContentLeft extends Component<MainContentLeftProps, MainContentLeftState>{
    constructor(props: any) {
        super(props)
        this.state = {
        }
    }


    render() {
        const { vm } = this.props

        return <>
            {
                vm.historyRoutePaths.map((routePath,i) => {
                    const cpt = WKApp.route.get(routePath)
                    return <div key={i} style={{"display":routePath === vm.currentMenus?.routePath?"block":"none","width":"100%","height":"100%"}}>
                        {cpt}
                    </div>
                })
            }
        </>
    }
}

export class MainPage extends Component {

    render() {
        return <Provider create={() => {
            return new MainVM()
        }} render={(vm: MainVM) => {
            return <WKLayout onRenderTab={(size) => {
                // if (size === ScreenSize.small) {
                //     return <TabLowScreen vm={vm}></TabLowScreen>
                // }
                return <TabNormalScreen vm={vm} />
            }} contentLeft={<MainContentLeft vm={vm}/>} onRightContext={(context)=>{
                WKApp.routeRight.setPush = (view)=>{
                    context.push(view)
                }
                WKApp.routeRight.setReplaceToRoot = (view) => {
                    context.replaceToRoot(view)
                }
                WKApp.routeRight.setPop = ()=> {
                    context.pop()
                }
                WKApp.routeRight.setPopToRoot = () => {
                    context.popToRoot()
                }
            }} onLeftContext={(context)=>{
                WKApp.routeLeft.setPush = (view)=>{
                    context.push(view)
                }
                WKApp.routeLeft.setReplaceToRoot = (view) => {
                    context.replaceToRoot(view)
                }
                WKApp.routeLeft.setPop = ()=> {
                    context.pop()
                }
                WKApp.routeLeft.setPopToRoot = () => {
                    context.popToRoot()
                }
            }} contentRight={ <div className="wk-chat-empty">
            <img src={require("./assets/start_chat.svg").default} alt=""></img>
        </div>} />
        }}>

        </Provider>
    }

    // render() {
    //     return <Provider create={() => {
    //         return new MainVM()
    //     }} render={(vm: MainVM) => {
    //         return <div className="wk-main">
    //             <div className="wk-main-sider">
    //                 <ul className="wk-main-sider-content">
    //                     <li className="wk-main-sider-avatar">
    //                         <img alt="" src={WKApp.shared.avatarUser(WKApp.loginInfo.uid || "")}></img>
    //                     </li>
    //                     {
    //                         vm.menusList.map((menus: Menus) => {
    //                             return <li className="wk-main-sider-item" title={menus.title} key={menus.id} onClick={() => {
    //                                 vm.currentMenus = menus
    //                                 if(menus.onPress) {
    //                                     menus.onPress()
    //                                 }else{
    //                                     WKApp.route.push(menus.routePath)
    //                                 }

    //                             }}>
    //                                 {
    //                                     menus.id === vm.currentMenus?.id ? menus.selectedIcon : menus.icon
    //                                 }
    //                             </li>
    //                         })
    //                     }
    //                     <li className={classnames("wk-main-sider-setting",vm.settingSelected?"collapsed":undefined)} onClick={()=>{
    //                         vm.settingSelected = !vm.settingSelected
    //                     }}>
    //                         <span className="wk-sider-setting-position-re wk-icon-bar"></span>
    //                         <span className="wk-icon-bar"></span>
    //                         <span className="wk-sider-setting-position-re wk-icon-bar"></span>
    //                     </li>
    //                 </ul>
    //                 <ul className={classnames("wk-sider-setting-list",vm.settingSelected?"open":undefined)}>
    //                         <li>检查版本更新</li>
    //                         <li>关闭桌面通知</li>
    //                         <li>退出登录</li>
    //                 </ul>
    //             </div>
    //             <div className="wk-main-content">
    //                 {WKApp.shared.content||""}
    //             </div>
    //         </div>
    //     }}></Provider>
    // }

}