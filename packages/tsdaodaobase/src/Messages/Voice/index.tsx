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
var BenzAMRRecorder = require('benz-amr-recorder');


export class VoiceContent extends MediaMessageContent {
    url!:string // 语音文件下载地址
    timeTrad!:number // 语音秒长
    waveform!:string // 语音波纹 base64编码
    // url = ""
    // timeTrad = 0 // 秒长
    // waveform  = []// 声音波浪
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

const playStatusWaitPlay = 1 // 等待播放
const playStatusPlaying = 2 // 播放中
const playStatusDownloading = 3 // 下载中

let voicePlayer = new BenzAMRRecorder();

export interface VoiceCellState {
    playStatus:number
    progress:number
}

export class VoiceCell extends MessageCell<any,VoiceCellState> {
    //  canvasRef = React.createRef();
    //  waveform;
    //  timeFormat = "00:00"
    //  voicePlayer
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
        this.waveform = Uint8Array.from(Buffer.from(this.content.waveform, "base64"))
        this.timeFormat = this.formatSecond(this.content.timeTrad)
    }

    formatSecond(s:any) {
        s = Math.ceil(s);
        let minute = parseInt(`${s / 60}`);
        let second = parseInt(`${s % 60}`);
        let minuteStr = ""
        let secondStr = ""
        if (minute > 9) {
            minuteStr = `${minute}`
        } else {
            minuteStr = `0${minute}`
        }
        if (second > 9) {
            secondStr = `${second}`
        } else {
            secondStr = `0${second}`
        }
        return minuteStr + ":" + secondStr
    }

    componentWillUnmount() {
        if (voicePlayer.isPlaying()) {
            voicePlayer.stop();
        }
        if (this.timer) {
            clearInterval(this.timer)
        }
    }

    playOrPauseVoice(e:any) {
        if (voicePlayer.isPlaying()) {
            voicePlayer.stop();
            
            this.setState({
                playStatus: playStatusWaitPlay,
            })

            // 当前播放中暂停
            if (e.currentTarget.className.indexOf('voicePlaying') > -1) {
                return;
            }
        }
        voicePlayer = new BenzAMRRecorder()
        const { message } = this.props

        const voiceURL = WKApp.dataSource.commonDataSource.getFileURL(this.content.url);

        if (message.voiceBuff) {
            voicePlayer.initWithArrayBuffer(message.voiceBuff).then(() => {
                voicePlayer.play();
            });
        } else {
            this.setState({
                playStatus: playStatusDownloading,
            })
            const p = new Promise((resolve, reject) => {
                let xhr = new XMLHttpRequest();
                xhr.open('GET', voiceURL, true);
                xhr.responseType = 'arraybuffer';
                xhr.onload = function () {
                    resolve(this.response);
                };
                xhr.onerror = function () {
                    reject(new Error('Failed to fetch ' + voiceURL));
                };
                xhr.send();
            });
            p.then((array) => {
                message.voiceBuff = array
                voicePlayer.initWithArrayBuffer(array).then(() => {
                    voicePlayer.play();
                });
            })
        }


        voicePlayer.onPlay(() => {
            this.setState({
                playStatus: playStatusPlaying,
            })
            this.timer = setInterval(() => {
                const progress = (voicePlayer.getCurrentPosition() / voicePlayer.getDuration()) * 100
                // console.log(progress)
                if (this.lightWavformRef.current) {
                    this.lightWavformRef.current.style.width = `${progress}%`
                }
                if (this.timeRef.current) {
                    this.timeRef.current.innerText = this.formatSecond(voicePlayer.getDuration() - voicePlayer.getCurrentPosition())
                }
                // this.setState({
                //     progress: (this.voicePlayer.getCurrentPosition()/this.content.timeTrad)*100,
                // })

            }, 100); // 这里的时间需要与 css  ease-in-out动画的时间一致
        });

        voicePlayer.onEnded(() => {
            console.log("播放结束");
            if(this.timer) {
                clearInterval(this.timer)
                this.timer = undefined
            }
           
            this.setState({
                playStatus: playStatusWaitPlay,
            })
            if (this.lightWavformRef.current) {
                this.lightWavformRef.current.style.width = `0%`
            }
            if (this.timeRef.current) {
                this.timeRef.current.innerText = this.formatSecond(voicePlayer.getDuration())
            }
        });
    }

    getPlayStatusClassname() {
        const { playStatus } = this.state
        if (playStatus === playStatusPlaying) {
            return "voicePlaying"
        }

        if (playStatus === playStatusDownloading) {
            return "voiceDownloading"
        }
        return ""
    }

    render() {
        const { message, context } = this.props
        const { playStatus } = this.state
        const isSend = message.message.send;
        // const url = WKApp.shared().commonProvider.getImageURL(content.url)
        return <MessageBase message={message} context={context} >
            {/* <canvas ref={this.canvasRef}  style={{width:"140px",height:"23px"}}/> */}
            <div className="wk-message-voice">
                <div className={classNames("voicePlay", this.getPlayStatusClassname())} onClick={(e) => {
                    this.playOrPauseVoice.bind(this)(e);
                }}>
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
                        <WaveCanvas barColor={"rgb(190, 190, 190)"} waveform={this.waveform ?? []} width={200} height={23} />
                        <div ref={this.lightWavformRef} className="wk-message-voice-lightWavform">
                            <WaveCanvas barColor={isSend ? "#fff" : '#2F70F5'} waveform={this.waveform ?? []} width={200} height={23} />
                        </div>
                    </div>
                    <div className="wk-message-voice-info-status">
                        <div className="wk-message-voice-info-time" ref={this.timeRef}>
                            {this.timeFormat}
                            {/* <div className={style.status}>*</div> */}
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