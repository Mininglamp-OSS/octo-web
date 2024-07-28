import React, { Component } from "react";
import "./index.css"
import { Input } from "@douyinfe/semi-ui";
import  { IconSearchStroked } from '@douyinfe/semi-icons';

export interface SearchProps {
    placeholder?: string
    onChange?:(v:string)=>void
    onEnterPress?:()=>void
}

export default class Search extends Component<SearchProps> {

    render() {
        const { placeholder,onChange,onEnterPress } = this.props
        return <div className="wk-search-box">
            <div className="wk-search-icon">
                <IconSearchStroked style={{ color: '#bbbfc4', fontSize: '20px' }} />
            </div>
            <div className="wk-search-input">
                {/* <input onChange={(v)=>{
                    if(onChange) {
                        onChange(v.target.value)
                    }
                }}  placeholder={placeholder} type="text" style={{ fontSize: '17px' }}  /> */}

                <Input onChange={(v)=>{
                    if(onChange) {
                        onChange(v)
                    }
                }} placeholder={placeholder} style={{ fontSize: '17px' }} onEnterPress={onEnterPress} ></Input>
            </div>
        </div>
    }
}