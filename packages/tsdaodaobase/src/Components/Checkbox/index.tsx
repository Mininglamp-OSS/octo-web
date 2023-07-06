
import React, { Component } from 'react';
import  './index.css'

export interface CheckboxProps {
    checked?:boolean
    onCheck?:()=>void
}

export default class Checkbox extends Component<CheckboxProps> {

    render() {
        const { checked,onCheck } = this.props;
        return (
            <div className="wk-check"  onClick={()=>{
                if(onCheck) {
                    onCheck();
                }
            }}>
                <img alt="" style={{width:'20px',height:'20px'}} src={checked?require('./checked.png').default:require('./uncheck.png').default}/>
            </div>
        );
    }
}