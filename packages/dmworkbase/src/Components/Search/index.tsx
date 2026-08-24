import React, { Component } from "react";
import "./index.css"
import { Input } from "@octo/ui";

export interface SearchProps {
    placeholder?: string
    onChange?:(v:string)=>void
    onEnterPress?:()=>void
}

export default class Search extends Component<SearchProps> {

    render() {
        const { placeholder,onChange,onEnterPress } = this.props
        return <div className="wk-search-box">
            <div className="wk-search-input">
                <Input.Search
                    onChange={(v) => { if (onChange) onChange(v) }}
                    placeholder={placeholder}
                    onEnterPress={onEnterPress}
                />
            </div>
        </div>
    }
}
