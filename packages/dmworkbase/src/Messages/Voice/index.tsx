import { MediaMessageContent, MessageContent } from "wukongimjssdk"
import React from "react"
import "./index.css"
import WaveCanvas from "../../Components/WaveCanvas"
import classNames from "classnames"
import { MessageCell } from "../MessageCell"
import MessageTrail from "../Base/tail"
import MessageBase from "../Base"
import WKApp from "../../App"
import { MessageContentTypeConst } from "../../Service/Const"
import { MessageWrap } from "../../Service/Model"
const BenzAMRRecorder = require('benz-amr-recorder');

export class VoiceContent extends MediaMessageContent {
    url!:string
    timeTrad!:number
    waveform!:string
    decodeJSON(content:any) {
        this.url = content["url"] || ""
        this.timeTrad = content["timeTrad"] || 0
        this.waveform = content["waveform"] || ""
    }
    get contentType() {
        return MessageContentTypeConst.voice
    }
    get conversationDigest() {
        return "[语音]"
    }
}

const playStatusWaitPlay = 1
const playStatusPlaying = 2
const playStatusDownloading = 3

/**
 * Singleton voice player manager.
 * Ensures only one voice plays at a time and properly cleans up resources.
 */
class VoicePlayerManager {
    private player: any = null;
    private activeComponent: VoiceCell | null = null;
    private activeXhr: XMLHttpRequest | null = null;

    stop() {
        if (this.player) {
            try {
                if (this.player.isPlaying()) {
                    this.player.stop();
                }
            } catch {
                // ignore errors during cleanup
            }
            this.player = null;
        }
        if (this.activeXhr) {
            this.activeXhr.abort();
            this.activeXhr = null;
        }
        if (this.activeComponent) {
            this.activeComponent.clearTimer();
            this.activeComponent = null;
        }
    }

    createPlayer(component: VoiceCell): any {
        this.stop();
        this.player = new BenzAMRRecorder();
        this.activeComponent = component;
        return this.player;
    }

    setXhr(xhr: XMLHttpRequest) {
        if (this.activeXhr) {
            this.activeXhr.abort();
        }
        this.activeXhr = xhr;
    }

    clearXhr() {
        this.activeXhr = null;
    }

    getPlayer() {
        return this.player;
    }

    isActiveComponent(component: VoiceCell): boolean {
        return this.activeComponent === component;
    }

    unregister(component: VoiceCell) {
        if (this.activeComponent === component) {
            this.stop();
        }
    }
}

const voicePlayerManager = new VoicePlayerManager();

export interface VoiceCellState {
    playStatus:number
    progress:number
}

export class VoiceCell extends MessageCell<any,VoiceCellState> {
    canvasRef!:React.RefObject<any>
    lightWavformRef!:React.RefObject<any>
    timeRef!:React.RefObject<any>
    content!:VoiceContent
    waveform!:Uint8Array
    timeFormat!:string
    timer?:NodeJS.Timeout

    constructor(props:any) {
        super(props)
        this.state = {
            progress: 0,
            playStatus: 0,
        }
        this.canvasRef = React.createRef()
        this.lightWavformRef = React.createRef()
        this.timeRef = React.createRef()
        const { message } = props
        this.content = message.content
        if(this.content.waveform && this.content.waveform.length>0) {
            try {
                this.waveform = new Uint8Array(atob(this.content.waveform).split('').map(char => char.charCodeAt(0)));
            } catch (e) {
                console.error('Failed to decode waveform base64:', e);
                this.waveform = new Uint8Array(0);
            }
        }
        this.timeFormat = this.formatSecond(this.content.timeTrad)
    }

    formatSecond(s:any) {
        s = Math.ceil(s);
        let minute = Math.floor(s / 60);
        let second = Math.floor(s % 60);
        let minuteStr = minute > 9 ? `${minute}` : `0${minute}`;
        let secondStr = second > 9 ? `${second}` : `0${second}`;
        return minuteStr + ":" + secondStr
    }

    clearTimer() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    componentWillUnmount() {
        voicePlayerManager.unregister(this);
        this.clearTimer();
    }

    playOrPauseVoice = (e:any) => {
        const currentPlayer = voicePlayerManager.getPlayer();
        if (currentPlayer && currentPlayer.isPlaying()) {
            const wasThisComponent = voicePlayerManager.isActiveComponent(this);
            voicePlayerManager.stop();
            this.setState({ playStatus: playStatusWaitPlay });
            if (wasThisComponent) {
                return;
            }
        }

        const player = voicePlayerManager.createPlayer(this);
        const { message } = this.props;
        const voiceURL = WKApp.dataSource.commonDataSource.getFileURL(this.content.url);

        if (message.voiceBuff) {
            player.initWithArrayBuffer(message.voiceBuff).then(() => {
                player.play();
            }).catch((error: Error) => {
                console.error('Failed to decode AMR audio:', error);
                this.setState({ playStatus: playStatusWaitPlay });
            });
        } else {
            this.setState({ playStatus: playStatusDownloading });
            const xhr = new XMLHttpRequest();
            voicePlayerManager.setXhr(xhr);
            xhr.open('GET', voiceURL, true);
            xhr.responseType = 'arraybuffer';
            xhr.onload = () => {
                voicePlayerManager.clearXhr();
                if (!voicePlayerManager.isActiveComponent(this)) return;
                message.voiceBuff = xhr.response;
                player.initWithArrayBuffer(xhr.response).then(() => {
                    player.play();
                }).catch((error: Error) => {
                    console.error('Failed to decode AMR audio:', error);
                    if (voicePlayerManager.isActiveComponent(this)) {
                        this.setState({ playStatus: playStatusWaitPlay });
                    }
                });
            };
            xhr.onerror = () => {
                voicePlayerManager.clearXhr();
                if (voicePlayerManager.isActiveComponent(this)) {
                    this.setState({ playStatus: playStatusWaitPlay });
                }
            };
            xhr.send();
        }

        player.onPlay(() => {
            this.setState({ playStatus: playStatusPlaying });
            this.timer = setInterval(() => {
                if (!voicePlayerManager.isActiveComponent(this)) {
                    this.clearTimer();
                    return;
                }
                const progress = (player.getCurrentPosition() / player.getDuration()) * 100;
                if (this.lightWavformRef.current) {
                    this.lightWavformRef.current.style.width = `${progress}%`;
                }
                if (this.timeRef.current) {
                    this.timeRef.current.innerText = this.formatSecond(player.getDuration() - player.getCurrentPosition());
                }
            }, 200);
        });

        player.onEnded(() => {
            this.clearTimer();
            this.setState({ playStatus: playStatusWaitPlay });
            if (this.lightWavformRef.current) {
                this.lightWavformRef.current.style.width = `0%`;
            }
            if (this.timeRef.current) {
                this.timeRef.current.innerText = this.formatSecond(player.getDuration());
            }
        });
    }

    getPlayStatusClassname() {
        const { playStatus } = this.state
        if (playStatus === playStatusPlaying) return "voicePlaying"
        if (playStatus === playStatusDownloading) return "voiceDownloading"
        return ""
    }

    render() {
        const { message, context } = this.props
        const { playStatus } = this.state
        const isSend = message.message.send;
        return <MessageBase message={message} context={context} >
            <div className="wk-message-voice">
                <div className={classNames("voicePlay", this.getPlayStatusClassname())} onClick={this.playOrPauseVoice}>
                    <i className="icon-play"></i>
                    <i className="icon-pause"></i>
                </div>
                {
                    playStatus === playStatusDownloading ? (<div className="mediaLoading">
                        <div className="progressSpinner">
                            <svg viewBox="0 0 48 48" height="48" width="48">
                                <circle stroke="#2F70F5" fill="transparent" strokeWidth="2" strokeDasharray="131.94689145077132 131.94689145077132" strokeDashoffset="125.34954687823276" strokeLinecap="round" r="21" cx="24" cy="24"></circle>
                            </svg>
                        </div>
                    </div>) : null
                }
                <div className="wk-message-voice-info">
                    <div className="wk-message-voice-waveform">
                        <WaveCanvas barColor={isSend?"rgb(255, 255, 255,0.5)":"rgb(0, 0, 0,0.2)"} waveform={this.waveform ?? []} width={200} height={23} />
                        <div ref={this.lightWavformRef} className="wk-message-voice-lightWavform">
                            <WaveCanvas barColor={isSend ? "#fff" : WKApp.config.themeColor} waveform={this.waveform ?? []} width={200} height={23} />
                        </div>
                    </div>
                    <div className="wk-message-voice-info-status">
                        <div className="wk-message-voice-info-time" ref={this.timeRef}>
                            {this.timeFormat}
                        </div>
                        <div className="wk-message-voice-info-tail">
                            <MessageTrail message={message} />
                        </div>
                    </div>
                </div>
            </div>
        </MessageBase>
    }
}
