import { TextArea } from "@douyinfe/semi-ui";
import { Input } from "@douyinfe/semi-ui/lib/es/input";
import React from "react";
import { Component } from "react";
import "./index.css"

export interface InputEditProps {
    // exceeded 表示是否超出最大限制
    onChange?:(value:string,exceeded?:boolean)=>void
    defaultValue?:string
    placeholder?:string
    maxCount?:number
    allowWrap?:boolean // 是否允许换行
}

export class InputEdit extends Component<InputEditProps>{

    render() {
        const {onChange,defaultValue,placeholder,maxCount,allowWrap} = this.props
        return <div className="wk-inputedit">
            <TextArea  defaultValue={defaultValue} onChange={(value)=>{
                let exceeded = false
                if( maxCount && value.length>maxCount) {
                    exceeded = true
                }
                if(onChange) {
                    onChange(value,exceeded)
                }
            }} autosize rows={2}  showClear maxCount={maxCount} onKeyDown={(e)=>{
                if(!allowWrap) {
                    if(e.keyCode!=13) return;
                    e.preventDefault();
                }
            }}></TextArea>
            <div className="wk-inputedit-placeholder">{placeholder}</div>
        </div>
    }
}