
import React from "react";
import { Component } from "react";
import { Color } from "react-color";

class WaveCanvasProps {
    waveform!: Uint8Array
    width: number = 200
    height: number = 23
    barColor: Color = "#000"
}

export default class WaveCanvas extends Component<WaveCanvasProps> {
    canvasRef = React.createRef<HTMLCanvasElement>();

    componentDidMount() {
        this.drawWaveform()
    }

    // 波浪数量
    waveformMaxNum() {
        const canvasWidth = this.canvasRef.current?.width!
        return canvasWidth / (this.barWidth() + this.barSpace())
    }

    barWidth() {
        return 2
    }
    barHeightMin() {
        return 2
    }
    barSpace() { // bar左右距离
        return 2
    }

    cutAudioData() {
        const { waveform } = this.props

        let height = this.canvasRef.current?.height||0
        let filteredSamplesMA = new Array<number>()
        let waveformCount = waveform.length // 当前波形数量
        let waveformMaxNum = this.waveformMaxNum() // 最大波形数量
        let minHeight = this.barHeightMin();
        if (waveformCount < waveformMaxNum) { // 当前波形小于最大波形则需要扩充
            let rate = (waveformMaxNum - waveformCount) / waveformCount;
            let expandValue = 0.0;
            for (let i = 0; i < waveformCount; i++) {
                expandValue += rate;
                let value = waveform[i];
                filteredSamplesMA.push(value)
                while (expandValue >= 1) {
                    filteredSamplesMA.push(value);
                    expandValue = expandValue - 1;
                }
            }
        } else if (waveformCount > waveformMaxNum) { // 当前波形大于最大波形则需要缩小
            let rate = 1 - (((waveformCount - waveformMaxNum) / waveformCount));
            let expandValue = rate;
            for (let i = 0; i < waveformCount; i++) {
                expandValue += rate;
                let value = waveform[i];
                if (expandValue >= 1) {
                    filteredSamplesMA.push(value)
                    expandValue = expandValue - 1;
                }
            }
        } else { // 等于
            for (let i = 0; i < waveformCount; i++) {
                let value = waveform[i];
                filteredSamplesMA.push(value)
            }
        }

        var maxWaveform = 0 // 最大波浪的值
        for (const value of filteredSamplesMA) {
            if (value > maxWaveform) {
                maxWaveform = value;
            }
        }
        //计算比例因子
        let scaleFactor = height / maxWaveform;
        //对所有数据进行“缩放”
        for (let i = 0; i < filteredSamplesMA.length; i++) {
            filteredSamplesMA[i] = filteredSamplesMA[i] * scaleFactor < minHeight ? minHeight : filteredSamplesMA[i] * scaleFactor;

        }
        return filteredSamplesMA

    }

    drawWaveform() {
        const { barColor } = this.props
        const waveformList = this.cutAudioData() //得到处理后的绘制数据

        const ctx = this.canvasRef.current?.getContext("2d")!

        //console.log("waveformList---->",waveformList)
        ctx.fillStyle = barColor.toString()
        const canvasHeight = this.canvasRef.current?.height!
        for (let index = 0; index < waveformList.length; index++) {
            //console.log('this.canvasRef.current?.height-->',this.canvasRef.current?.height)
            ctx.fillRect(index * (this.barWidth() + this.barSpace()), canvasHeight - waveformList[index], this.barWidth(), waveformList[index])
        }
    }

    render() {
        const { width, height } = this.props;
        return <div>
            <canvas ref={this.canvasRef} width={width} height={height} style={{ width: `${width}px`, height: `${height}px` }} />
        </div>
    }
}