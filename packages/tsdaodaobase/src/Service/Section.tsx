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

    constructor(v:{cell:ElementType,properties?:any,sort?:number}) {
        this.cell = v.cell
        this.properties = v.properties
        if(v.sort) {
            this.sort = v.sort
        }
    }

}