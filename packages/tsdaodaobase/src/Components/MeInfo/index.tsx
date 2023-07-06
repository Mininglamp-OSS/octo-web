import React, { Component, ReactNode } from "react";
import RouteContext from "../../Service/Context";
import Provider, { IProviderListener } from "../../Service/Provider";
import RoutePage from "../RoutePage";
import { MeInfoVM } from "./vm";
import "./index.css"
import Sections from "../Sections";

export interface MeInfoProps {
    onClose: ()=>void
}

export  class MeInfo extends Component<MeInfoProps> {


    render() {
        const { onClose } = this.props
        return <Provider create={function (): IProviderListener {
            return new MeInfoVM()
        }} render={function (vm: MeInfoVM): ReactNode {
            return <RoutePage title="个人信息" onClose={()=>{
                if(onClose) {
                    onClose()
                }
            }} render={function (context: RouteContext<any>): ReactNode {

                return <div className="wk-meinfo">
                    <div className="wk-meinfo-sections">
                        <Sections sections={vm.sections(context)}></Sections>
                    </div>
                </div>

            }}></RoutePage>
        }}></Provider>
    }
}