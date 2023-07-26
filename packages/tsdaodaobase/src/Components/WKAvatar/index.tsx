import { Channel } from "wukongimjssdk";
import React from "react";
import { Component, CSSProperties } from "react";
import WKApp from "../../App";
import "./index.css"

interface WKAvatarProps {
    channel?:Channel
    src?:string
    style?: CSSProperties
    random?:string
}

export default class WKAvatar extends Component<WKAvatarProps> {

    getImageSrc() {
        const {channel,src,random} = this.props
        let imgSrc = ""
        if(src && src.trim()!=="") {
            imgSrc = src
        }else {
            if(channel) {
                imgSrc = WKApp.shared.avatarChannel(channel)
            }
        }
        if(random && random!=="") {
            imgSrc = `${imgSrc}#${random}`
        }
        return imgSrc
    }
    render() {
        const {style} = this.props
        return <img  alt="" style={style} className="wk-avatar" src={this.getImageSrc()}/>
    }
}