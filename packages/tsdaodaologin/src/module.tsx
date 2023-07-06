
import {WKApp} from '@tsdaodao/base'
import { IModule } from '@tsdaodao/base'
import React from 'react'
import Login from './login'
export default  class LoginModule implements IModule {

    id(): string {
        return "LoginModule"
    }
    init(): void {
        console.log("【LoginModule】初始化")
        WKApp.route.register("/login",(param:any):JSX.Element =>{
            return <Login />
        })
    }
}