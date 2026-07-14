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
                                    return <div key={j} className="wk-section-row">
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
