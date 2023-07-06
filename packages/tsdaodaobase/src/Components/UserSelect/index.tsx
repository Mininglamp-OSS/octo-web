import React from "react";
import { Component } from "react";
import { FinishButtonContext } from "../../Service/Context";
import WKApp from "../../App";
import IndexTable, { IndexTableItem } from "../IndexTable";
import WKViewQueueHeader from "../WKViewQueueHeader";
import "./index.css"
import { ContactsStatus } from "../../Service/DataSource/DataSource";

export interface UserSelectProps {
    users?: IndexTableItem[]
    disableSelectList?: string[]
    onSelect?: (items: IndexTableItem[]) => void
    cantMulit?:boolean  // 是否不允许多选
}


export default class UserSelect extends Component<UserSelectProps>{

    render() {
        const { users, onSelect, disableSelectList,cantMulit } = this.props
        return <div className="wk-userselect">
            <IndexTable disableSelectList={disableSelectList} onSelect={onSelect} canSelect={!cantMulit} items={users || []}></IndexTable>
        </div>
    }
}

export interface ContactsSelectProps extends UserSelectProps {
    disableSelectList?: string[]
    showHeader?: boolean
    showFinishButton?:boolean
    onFinished?:()=>void
    onBack?:()=>void
    onFinishButtonContext?:(context:FinishButtonContext)=>void
}

export class ContactsSelect extends Component<ContactsSelectProps> {
    finishButtonContext!:FinishButtonContext
    render() {
        const { onSelect, disableSelectList, showHeader,onFinished,onBack,onFinishButtonContext,showFinishButton } = this.props
        return <div className="wk-contactsselect">
            {
                showHeader ? <WKViewQueueHeader showFinishButton={showFinishButton} title="联系人选择" onFinishButtonContext={(context)=>{
                    this.finishButtonContext = context
                    this.finishButtonContext.disable(true)
                    if(onFinishButtonContext) {
                        onFinishButtonContext(context)
                    }
                }} onFinished={onFinished} onBack={()=>{
                    if(onBack) {
                        onBack()
                    }
                }}></WKViewQueueHeader> : undefined
            }
            <div className="wk-contactsselect-content">
                <UserSelect disableSelectList={disableSelectList} onSelect={(items)=>{
                    if(showHeader) {
                        if(items.length>0) {
                            this.finishButtonContext.disable(false)
                        }else{
                            this.finishButtonContext.disable(true)
                        }
                    }
                   
                    if(onSelect) {
                        onSelect(items)
                    }
                }} users={WKApp.dataSource.contactsList.filter((c)=>c.status !== ContactsStatus.Blacklist).map((contacts) => {
                    return new IndexTableItem(contacts.uid, contacts.name, contacts.avatar)
                })}></UserSelect>
            </div>

        </div>
    }
}