import { Channel, ChannelTypePerson, ChannelTypeGroup } from "wukongimjssdk";
import React from "react";
import { Component, CSSProperties } from "react";
import classNames from "classnames";
import WKApp from "../../App";
import { getCurrentImChannelInfo } from "../../im-runtime/currentChannelRuntime";
import "./index.css"

/**
 * Check if a user is a bot by looking up channelInfo.
 * Centralizes the repeated channelInfo lookup pattern.
 */
export function isBot(uid: string): boolean {
    const info = getCurrentImChannelInfo(new Channel(uid, ChannelTypePerson))
    return info?.orgData?.robot === 1
}

interface WKAvatarProps {
    channel?: Channel
    src?: string
    style?: CSSProperties
    random?: string
    /**
     * 启用视口懒加载。不同于浏览器原生 `loading="lazy"`（其 root 固定为 viewport，
     * 在 50vh 弹窗等"内部滚动容器比 viewport 小"的场景会误判整屏元素都可见），
     * 这里用 IntersectionObserver 并自动把 root 绑到最近可滚动祖先，进入视口
     * 之前不写入真实 src，避免打开长列表时一次性并发请求所有头像。
     */
    lazy?: boolean
}

const defaultAvatarSVG = `
  data:image/svg+xml;charset=UTF-8,<svg width="50" height="50" xmlns="http://www.w3.org/2000/svg">
  <rect width="50" height="50" x="0" y="0" rx="20" ry="20" fill="rgb(220,220,220)" />
</svg>
`;

export interface WKAvatarState {
    src: string
    loadedErr: boolean // 图片是否加载错误
}

// 找到最近的可滚动祖先元素，作为 IntersectionObserver 的 root。
// 未找到（或 DOM 不在文档中）时返回 null，IO 会 fallback 到 viewport。
function findScrollParent(node: HTMLElement | null): HTMLElement | null {
    let el: HTMLElement | null = node?.parentElement ?? null
    while (el && el !== document.body && el !== document.documentElement) {
        const style = window.getComputedStyle(el)
        const overflowY = style.overflowY
        const overflowX = style.overflowX
        if (
            overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay" ||
            overflowX === "auto" || overflowX === "scroll" || overflowX === "overlay"
        ) {
            return el
        }
        el = el.parentElement
    }
    return null
}

export default class WKAvatar extends Component<WKAvatarProps, WKAvatarState> {

    private imgRef = React.createRef<HTMLImageElement>()
    private observer: IntersectionObserver | null = null
    private realSrcCached = ""

    constructor(props: any) {
        super(props);
        const realSrc = this.getImageSrc()
        this.realSrcCached = realSrc
        // lazy=true 时，src 先留空，待 IO 回调后再写入真实 URL
        this.state = {
            src: props.lazy ? "" : realSrc,
            loadedErr: false,
        };
    }

    componentDidMount() {
        // 订阅头像变更事件：当 changeChannelAvatarTag 在别处被调用（例如
        // BotDetailModal 里 bot 主人上传新头像）时，匹配到同一 channel 的
        // WKAvatar 实例就地重新计算 src，避免整页刷新。
        WKApp.mittBus.on("channel-avatar-changed", this.handleAvatarChanged);

        if (this.props.lazy) {
            this.setupLazyObserver()
        }
    }

    componentWillUnmount() {
        WKApp.mittBus.off("channel-avatar-changed", this.handleAvatarChanged);
        this.disconnectObserver()
    }

    private setupLazyObserver() {
        if (typeof IntersectionObserver === "undefined") {
            // 老浏览器降级：直接设置真实 src
            this.setState({ src: this.realSrcCached })
            return
        }
        const target = this.imgRef.current
        if (!target) return
        const root = findScrollParent(target)
        this.observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    this.setState({ src: this.realSrcCached, loadedErr: false })
                    this.disconnectObserver()
                    break
                }
            }
        }, { root, threshold: 0, rootMargin: "100px 0px" })
        this.observer.observe(target)
    }

    private disconnectObserver() {
        if (this.observer) {
            this.observer.disconnect()
            this.observer = null
        }
    }

    private handleAvatarChanged = (payload: { channelID: string; channelType: number }) => {
        const { channel } = this.props;
        if (!channel) return;
        if (
            channel.channelID === payload.channelID &&
            channel.channelType === payload.channelType
        ) {
            const realSrc = this.getImageSrc()
            this.realSrcCached = realSrc
            this.setState({
                src: this.props.lazy && !this.state.src ? "" : realSrc,
                loadedErr: false,
            });
        }
    };

    componentDidUpdate(prevProps: WKAvatarProps) {
        // Update src when props change
        const srcChanged = prevProps.src !== this.props.src;
        const randomChanged = prevProps.random !== this.props.random;
        const channelChanged =
            prevProps.channel?.channelID !== this.props.channel?.channelID ||
            prevProps.channel?.channelType !== this.props.channel?.channelType;

        if (srcChanged || channelChanged || randomChanged) {
            const realSrc = this.getImageSrc()
            this.realSrcCached = realSrc
            // lazy 模式下如果图片还没进入视口，保持空 src，等 observer 触发；
            // 如果已经加载过（state.src 非空），才跟随 props 变化更新。
            const alreadyVisible = !this.props.lazy || !!this.state.src
            this.setState({
                src: alreadyVisible ? realSrc : "",
                loadedErr: false,
            });
        }
    }

    getImageSrc() {
        const { channel, src, random } = this.props
        let imgSrc = ""
        if (src && src.trim() !== "") {
            imgSrc = src
        } else {
            if (channel) {
                imgSrc = WKApp.shared.avatarChannel(channel)
            }
        }
        if (random && random !== "") {
            imgSrc = `${imgSrc}#${random}`
        }
        return imgSrc
    }
    handleImgError = () => {
        this.setState({ src: defaultAvatarSVG, loadedErr: true });
    };

    getAvatarClass() {
        const { channel } = this.props
        if (!channel) return ""
        if (channel.channelType === ChannelTypeGroup) return "wk-avatar-group"
        if (channel.channelType === ChannelTypePerson) {
            const info = getCurrentImChannelInfo(channel)
            if (info?.orgData?.robot === 1) return "wk-avatar-ai"
        }
        return ""
    }

    render() {
        const { style } = this.props
        // 空 src 时渲染 <img> 仍需占位（用 defaultAvatarSVG，避免浏览器 broken-image）
        const displaySrc = this.state.src || defaultAvatarSVG
        return <img
            ref={this.imgRef}
            alt=""
            style={style}
            className={classNames("wk-avatar", this.getAvatarClass())}
            src={displaySrc}
            onError={this.handleImgError}
            decoding="async"
        />
    }
}
