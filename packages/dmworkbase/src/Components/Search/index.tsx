import React, { Component } from "react";
import "./index.css"
import { Input } from "@octo/ui";
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
                <IconSearchStroked style={{ fontSize: '16px' }} />
            </div>
            <div className="wk-search-input">
                <Input
                    onChange={(v) => { if (onChange) onChange(v) }}
                    placeholder={placeholder}
                    onEnterPress={onEnterPress}
                />
            </div>
        </div>
    }
}
