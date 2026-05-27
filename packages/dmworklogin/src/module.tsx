
import {WKApp} from '@octo/base'
import { IModule } from '@octo/base'
import React from 'react'
import Login from './login'
import { ensureLoginI18n } from './i18n'
export default  class LoginModule implements IModule {

    id(): string {
        return "LoginModule"
    }
    init(): void {
        ensureLoginI18n()
        WKApp.route.register("/login",(param:any):JSX.Element =>{
            return <Login />
        })
    }
}
