import React, { Component } from "react";
import { Section } from "../../Service/Section";
import "./index.css"

export interface SectionsProps {
    sections: Section[]
}

export default class Sections extends Component<SectionsProps> {

    render() {
        const { sections } = this.props
        return <div className="wk-sections">
            {
                sections.map((section, i) => {
                    return <div key={i} className="wk-section">
                        {
                            section.title && section.title !== "" ? <div className="wk-section-title">{section.title}</div> : undefined
                        }

                        <div className="wk-channelsetting-section-rows">
                            {
                                section.rows?.map((row, j) => {
                                    const Cell = row.cell
                                    const { key: cellKey, ...cellProps } = row.properties ?? {}
                                    // 埋点:行配置带 trackEvent → wrapper 挂 data-track,整行点击经既有捕获委托上报;
                                    // trackProps 渲染成 data-track-*(collectDatasetProps 采,不读 value/正文)。
                                    // 未设则不挂任何属性,行为与旧实现完全一致(零回归)。
                                    const trackAttrs: Record<string, string> = {}
                                    if (row.trackEvent) {
                                        trackAttrs["data-track"] = row.trackEvent
                                        if (row.trackProps) {
                                            for (const k in row.trackProps) {
                                                trackAttrs[`data-track-${k}`] = String(row.trackProps[k])
                                            }
                                        }
                                    }
                                    return <div key={j} className="wk-section-row" {...trackAttrs}>
                                        <Cell key={cellKey} {...cellProps}></Cell>
                                    </div>
                                })
                            }

                        </div>
                        {
                            section.subtitle && section.subtitle !== "" ? <div className="wk-section-subtitle">
                                {section.subtitle }
                            </div> : undefined
                        }
                    </div>
                })
            }
        </div>
    }
}
