import React, { Component } from "react"
import { ZoomIn, ZoomOut } from "lucide-react"
import AvatarEditor from "react-avatar-editor"
import { I18nContext } from "../../i18n"
import "./index.css"

const EDITOR_SIZE = 262
const EDITOR_BORDER = 70
const EDITOR_BORDER_RADIUS = 280
const DEFAULT_SCALE = 1.2
const MIN_SCALE = 0.5
const MAX_SCALE = 3
const SCALE_STEP = 0.1
const EDITOR_CANVAS_SIZE = EDITOR_SIZE + EDITOR_BORDER * 2
const EDITOR_CANVAS_STYLE: React.CSSProperties = {
    display: "block",
    width: EDITOR_CANVAS_SIZE,
    height: "auto",
    maxWidth: "100%",
    maxHeight: "100%",
    aspectRatio: "1 / 1",
}


interface WKAvatarEditorProps {
    file: any
}

interface WKAvatarEditorState {
    scale: number
}

export class WKAvatarEditor extends Component<WKAvatarEditorProps, WKAvatarEditorState> {
    static contextType = I18nContext
    declare context: React.ContextType<typeof I18nContext>

    editor?: AvatarEditor|null
    state: WKAvatarEditorState = {
        scale: DEFAULT_SCALE
    }

    getImageScaledToCanvas(): HTMLCanvasElement|undefined {
        return this.editor?.getImageScaledToCanvas()
    }

    componentDidUpdate(prevProps: WKAvatarEditorProps) {
        if (prevProps.file !== this.props.file && this.state.scale !== DEFAULT_SCALE) {
            this.setState({ scale: DEFAULT_SCALE })
        }
    }

    handleScaleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        this.setState({ scale: Number(event.target.value) })
    }

    updateScale = (delta: number) => {
        this.setState(({ scale }) => ({
            scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number((scale + delta).toFixed(1))))
        }))
    }

    render(): React.ReactNode {
        const { file } = this.props
        const { scale } = this.state
        return <div className="wk-avatar-editor">
            <div className="wk-avatar-editor__canvas">
                <AvatarEditor
                    ref={(rf)=>{
                        this.editor = rf
                    }}
                    image={file}
                    width={EDITOR_SIZE}
                    height={EDITOR_SIZE}
                    border={EDITOR_BORDER}
                    color={[255, 255, 255, 0.6]} // RGBA
                    borderRadius={EDITOR_BORDER_RADIUS}
                    scale={scale}
                    rotate={0}
                    style={EDITOR_CANVAS_STYLE}
                />
            </div>
            <div className="wk-avatar-editor__zoom">
                <button
                    type="button"
                    className="wk-avatar-editor__zoom-button"
                    onClick={() => this.updateScale(-SCALE_STEP)}
                    disabled={scale <= MIN_SCALE}
                    aria-label={this.context.t("base.avatarEditor.zoomOut")}
                    title={this.context.t("base.avatarEditor.zoomOut")}
                >
                    <ZoomOut size={18} aria-hidden="true" />
                </button>
                <input
                    className="wk-avatar-editor__zoom-input"
                    type="range"
                    min={MIN_SCALE}
                    max={MAX_SCALE}
                    step={SCALE_STEP}
                    value={scale}
                    onChange={this.handleScaleChange}
                    aria-valuetext={this.context.t("base.avatarEditor.zoomValue", {
                        values: { value: Math.round(scale * 100) }
                    })}
                    aria-label={this.context.t("base.avatarEditor.zoom")}
                />
                <button
                    type="button"
                    className="wk-avatar-editor__zoom-button"
                    onClick={() => this.updateScale(SCALE_STEP)}
                    disabled={scale >= MAX_SCALE}
                    aria-label={this.context.t("base.avatarEditor.zoomIn")}
                    title={this.context.t("base.avatarEditor.zoomIn")}
                >
                    <ZoomIn size={18} aria-hidden="true" />
                </button>
            </div>
        </div>
    }
}

export default WKAvatarEditor
