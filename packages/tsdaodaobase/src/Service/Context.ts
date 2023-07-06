



export interface FinishButtonContext {
    loading(loading:boolean):void
    disable(disable:boolean):void
}

export class RouteContextConfig {
    title?: string
    showFinishButton?: boolean
    finishButtonTitle?: string
    onFinish?: () => void
    onFinishContext?:(finishButtonContext:FinishButtonContext) => void

    constructor(v: { title?: string, showFinishButton?: boolean, finishButtonTitle?: string, onFinish?: () => void,onFinishContext?:(finishButtonContext:FinishButtonContext) => void }) {
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
    setRouteData(data:T):void
    routeData():T
}