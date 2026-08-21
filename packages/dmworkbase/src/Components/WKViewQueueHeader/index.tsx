import { Button } from "@octo/ui";

import React from "react"
import { Component, ReactNode } from "react"
import WKApp,{ThemeMode} from "../../App"
import { FinishButtonContext } from "../../Service/Context"
import { I18nContext } from "../../i18n"

import "./index.css"

export interface WKViewQueueHeaderProps {
    title:string
    onBack?:()=>void
    hideBack?:boolean // 是否隐藏返回按钮
    showFinishButton?:boolean // 是否显示完成按钮
    onFinished?:()=>void;
    onFinishButtonContext?:(context:FinishButtonContext)=>void
    action?: JSX.Element
}

export interface WKViewQueueHeaderState {
    loading?:boolean
    disable?:boolean
}

export default class WKViewQueueHeader extends Component<WKViewQueueHeaderProps,WKViewQueueHeaderState> implements FinishButtonContext {
    static contextType = I18nContext
    declare context: React.ContextType<typeof I18nContext>

    constructor(props:any) {
        super(props)
        this.state = {
            loading: false,
            disable: false,
        }
    }
    loading(loading: boolean): void {
       this.setState({
           loading: loading,
       })
    }
    disable(disable: boolean): void {
       this.setState({
           disable: disable,
       })
    }

    componentDidMount() {
        const { onFinishButtonContext } = this.props
        if(onFinishButtonContext) {
            onFinishButtonContext(this)
        }
    }

    render(): ReactNode {
       const  isDark = WKApp.config.themeMode === ThemeMode.dark
        const { title,onBack,hideBack,showFinishButton,onFinished,action } = this.props
        const { loading,disable } = this.state
        return <div className="wk-viewqueueheader">
           {
               hideBack?undefined: <div className="wk-viewqueueheader-back" onClick={()=>{
                if(onBack) {
                    onBack()
                }
            }}>
                <img src={isDark ? new URL("./assets/nav_back_dark.png", import.meta.url).href : new URL("./assets/nav_back.png", import.meta.url).href}></img>
            </div>
           }
            <div className="wk-viewqueueheader-content">
                    <div className="wk-viewqueueheader-content-title">
                            {title}
                    </div>
                    {
                        showFinishButton?<div className="wk-viewqueueheader-content-action">
                        <Button type="primary" theme='solid' loading={loading} disabled={disable} onClick={()=>{
                            if(onFinished) {
                                onFinished()
                            }
                        }}>
                            {this.context.t("base.common.done")}
                        </Button>
                    </div>:undefined
                    }
                    {
                        action
                    }
            </div>
        </div>
    }
}
