import React, { Component, ReactNode } from "react"
import RouteContext, { RouteContextConfig } from "../../Service/Context"
import { Row, Section } from "../../Service/Section"
import Sections from "../Sections"
import { ListItem } from "../ListItem"
import PersonaSettings from "../PersonaSettings"
import "./index.css"

/**
 * ExperimentalFeatures —— 「实验性功能」子页面（YUJ-1797 / GH octo-web#98）。
 *
 * MeInfo 默认不再直接挂「我的分身」入口，改为收进此子页面下；MeInfo 这一级入口
 * 默认隐藏，由「OCTO 号」行连击 5 次解锁（类似 Android 开发者模式）。详见 MeInfo/vm.tsx。
 *
 * 设计要点：
 *   - 嵌入式组件，不自带 RoutePage —— 由 MeInfo 的 RoutePage 通过 context.push
 *     推入栈（与 PersonaSettings 嵌入模式同款语义，共享同一根 back arrow）。
 *   - 入口列表用 Section/Row DSL，与 MeInfo 主页风格一致，便于后续扩展更多
 *     「实验性功能」条目（例如调试开关、灰度入口）只需要往 sections 里塞 Row。
 *   - 「我的分身」点击仍 push PersonaSettings(routeContext)，透传当前 context，
 *     保持「实验性功能 → 我的分身 → 分身详情」整条栈共用一根 back arrow。
 */
interface ExperimentalFeaturesProps {
    routeContext: RouteContext<any>
}

export default class ExperimentalFeatures extends Component<ExperimentalFeaturesProps> {

    private sections(): Section[] {
        const { routeContext } = this.props
        return [
            new Section({
                rows: [
                    new Row({
                        cell: ListItem,
                        properties: {
                            title: "我的分身",
                            subTitle: "",
                            onClick: () => {
                                routeContext.push(
                                    <PersonaSettings routeContext={routeContext} />,
                                    new RouteContextConfig({ title: "我的分身" }),
                                )
                            }
                        }
                    })
                ]
            })
        ]
    }

    render(): ReactNode {
        return (
            <div className="wk-experimental-features">
                <div className="wk-experimental-features-sections">
                    <Sections sections={this.sections()}></Sections>
                </div>
            </div>
        )
    }
}
