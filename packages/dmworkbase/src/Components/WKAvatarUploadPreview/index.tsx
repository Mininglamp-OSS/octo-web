import React from "react";
import { Component } from "react";
import "./index.css";

interface WKAvatarUploadPreviewProps {
    file: File
    shape?: "circle" | "bot"
}

interface WKAvatarUploadPreviewState {
    hasPreview: boolean
}

export class WKAvatarUploadPreview extends Component<WKAvatarUploadPreviewProps, WKAvatarUploadPreviewState> {
    private objectUrl = "";
    private imageRef = React.createRef<HTMLImageElement>();

    state: WKAvatarUploadPreviewState = {
        hasPreview: false,
    };

    componentDidMount() {
        this.updatePreviewUrl(this.props.file);
    }

    componentDidUpdate(prevProps: WKAvatarUploadPreviewProps) {
        if (prevProps.file !== this.props.file) {
            this.updatePreviewUrl(this.props.file);
        }
    }

    componentWillUnmount() {
        this.revokePreviewUrl();
    }

    private updatePreviewUrl(file: File) {
        this.revokePreviewUrl();
        this.objectUrl = URL.createObjectURL(file);
        this.setState({ hasPreview: true }, () => {
            this.syncImageSrc();
        });
    }

    private revokePreviewUrl() {
        if (this.objectUrl) {
            this.imageRef.current?.removeAttribute("src");
            URL.revokeObjectURL(this.objectUrl);
            this.objectUrl = "";
        }
    }

    private syncImageSrc() {
        if (this.imageRef.current && this.objectUrl) {
            this.imageRef.current.src = this.objectUrl;
        }
    }

    render(): React.ReactNode {
        const { shape = "circle" } = this.props;
        const { hasPreview } = this.state;
        return <div className="wk-avatar-upload-preview">
            {hasPreview && (
                <img
                    ref={this.imageRef}
                    className={`wk-avatar-upload-preview__image wk-avatar-upload-preview__image--${shape}`}
                    alt=""
                />
            )}
        </div>
    }
}
