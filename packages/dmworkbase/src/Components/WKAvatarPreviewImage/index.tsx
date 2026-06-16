import React from "react";
import { Component } from "react";
import { Image } from "@douyinfe/semi-ui";
import { Channel } from "wukongimjssdk";
import WKApp from "../../App";

interface WKAvatarPreviewImageProps {
    channel: Channel
}

interface WKAvatarPreviewImageState {
    src: string
}

export default class WKAvatarPreviewImage extends Component<WKAvatarPreviewImageProps, WKAvatarPreviewImageState> {
    state: WKAvatarPreviewImageState = {
        src: this.getImageSrc(),
    };

    componentDidMount() {
        WKApp.mittBus.on("channel-avatar-changed", this.handleAvatarChanged);
    }

    componentDidUpdate(prevProps: WKAvatarPreviewImageProps) {
        const channelChanged =
            prevProps.channel.channelID !== this.props.channel.channelID ||
            prevProps.channel.channelType !== this.props.channel.channelType;
        if (channelChanged) {
            this.setState({ src: this.getImageSrc() });
        }
    }

    componentWillUnmount() {
        WKApp.mittBus.off("channel-avatar-changed", this.handleAvatarChanged);
    }

    private getImageSrc() {
        return WKApp.shared.avatarChannel(this.props.channel);
    }

    private handleAvatarChanged = (payload: { channelID: string; channelType: number }) => {
        const { channel } = this.props;
        if (
            channel.channelID === payload.channelID &&
            channel.channelType === payload.channelType
        ) {
            this.setState({ src: this.getImageSrc() });
        }
    };

    render(): React.ReactNode {
        const { src } = this.state;
        return <Image key={src} src={src} />;
    }
}
