import { ElementType } from "react"
import RouteContext from "./Context"
import { EndpointManager } from "./Module"

export default class SectionManager {
    register(category:string,sectionID:string,sectionFnc:(context:RouteContext<any>)=>Section|undefined,sort?:number) {
        EndpointManager.shared.setMethod(`section-${sectionID}`,(param:any)=>{
            return sectionFnc(param)
        },{
            category: category,
            sort: sort,
        })
    }

    sections(category:string,context:RouteContext<any>) :Section[] {
       return EndpointManager.shared.invokes(category,context)
    }

    section(sectionID:string,context:RouteContext<any>) :Section {
        return EndpointManager.shared.invoke(`section-${sectionID}`,context)
    }

}

export  class Section {
    title?: string
    rows?: Row[]
    subtitle?:string

    constructor(v:{title?:string,rows?:Row[],subtitle?:string}) {
        this.title = v.title
        this.rows = v.rows
        this.subtitle = v.subtitle

        
    }
    get sortRows() {
      return  this.rows?.sort((a,b)=>{
            return a.sort - b.sort
        })
    }
}

export class Row {
    cell!: ElementType
    properties?: any
    sort:number = 0
    /**
     * 埋点(可选):设了就让通用 <Sections> 渲染器在行 wrapper 上挂 `data-track={trackEvent}`,
     * 整行点击即经既有捕获委托上报——config 驱动面(群信息/用户信息/设置项)不必逐个 JSX 补
     * data-track,埋点成为 Row 的一等字段,和 onClick 并排,快速多人迭代时漏不掉。
     * 事件名须先在服务端采集器注册。`trackProps` 为静态枚举,渲染成 data-track-*(经
     * collectDatasetProps 采集,绝不读控件 value/正文)。整行导航类适用;行内自带 data-track
     * 的子控件(如开关)仍走自己那条,勿在这类行重复设 trackEvent。
     */
    trackEvent?: string
    trackProps?: Record<string, string | number | boolean>

    constructor(v:{cell:ElementType,properties?:any,sort?:number,trackEvent?:string,trackProps?:Record<string, string | number | boolean>}) {
        this.cell = v.cell
        this.properties = v.properties
        if(v.sort) {
            this.sort = v.sort
        }
        this.trackEvent = v.trackEvent
        this.trackProps = v.trackProps
    }

}