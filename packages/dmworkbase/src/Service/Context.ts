



import type { ReactNode } from "react"

export interface FinishButtonContext {
    loading(loading:boolean):void
    disable(disable:boolean):void
}

export class RouteContextConfig {
    /**
     * 路由表头标题。可传字符串，或传 ReactNode（如 `<I18nText/>`）以获得随语言
     * 切换实时更新的标题——title 在 push 时只存一次，纯字符串快照不会响应 i18n。
     */
    title?: ReactNode
    showFinishButton?: boolean
    finishButtonTitle?: string
    onFinish?: () => void
    onFinishContext?:(finishButtonContext:FinishButtonContext) => void

    constructor(v: { title?: ReactNode, showFinishButton?: boolean, finishButtonTitle?: string, onFinish?: () => void,onFinishContext?:(finishButtonContext:FinishButtonContext) => void }) {
         this.title = v.title
         this.showFinishButton = v.showFinishButton
         this.finishButtonTitle = v.finishButtonTitle
         this.onFinish = v.onFinish
         this.onFinishContext = v.onFinishContext
    }
}

export default interface RouteContext<T> {
    push(view: JSX.Element, config?: RouteContextConfig): void
    pop(): void
    popToRoot():void
    /**
     * 替换栈顶视图（不改栈深度）。等价于「同一帧 pop + push」但避免了 pop/push
     * 异步 setState 之间读到陈旧 `pushViewCount` 导致栈长被错误地 +1。
     *
     * 用途：A → B 的同帧跳转（例如 create 成功后直接进 edit），而非「先回到 A
     * 再去 C」。当栈为空时退化为 push（替换 root 行为由调用方各 RoutePage 自定，
     * 详见 RoutePage.replace）。
     */
    replace(view: JSX.Element, config?: RouteContextConfig): void
    setRouteData(data:T):void
    routeData():T
}