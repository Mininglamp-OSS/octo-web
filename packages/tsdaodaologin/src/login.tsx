import axios from "axios";
import React, { Component } from "react";
import { Button, Spin, Toast } from '@douyinfe/semi-ui';
import './login.css'
import QRCode from 'qrcode.react';
import { WKApp, Provider } from "@tsdaodao/base"
import { LoginStatus, LoginType, LoginVM } from "./login_vm";
import classNames from "classnames";

type LoginState = {
    loginStatus: string
    loginUUID: string
    getLoginUUIDLoading: boolean
    scanner?: string  // 扫描者的uid
    qrcode?: string
}

class Login extends Component<any, LoginState> {




    render() {

        return <Provider create={() => {
            return new LoginVM()
        }} render={(vm: LoginVM) => {
            return <div className="wk-login">
                <div className="wk-login-content">
                    <div className="wk-login-content-phonelogin" style={{ "display": vm.loginType === LoginType.phone ? "block" : "none" }}>
                        <div className="wk-login-content-logo">
                            <img src={"/logo.png"} alt="logo" />
                        </div>
                        <div className="wk-login-content-slogan">
                            更愉快的与朋友交流
                        </div>
                        <div className="wk-login-content-form">
                            <input type="text" placeholder="手机号" onChange={(v) => {
                                vm.username = v.target.value
                            }}></input>
                            <input type="password" placeholder="密码" onChange={(v) => {
                                vm.password = v.target.value
                            }}></input>
                            <div className="wk-login-content-form-buttons">
                                <Button loading={vm.loginLoading} className="wk-login-content-form-ok" type='primary' theme='solid' onClick={async () => {
                                    if (!vm.username) {
                                        Toast.error("手机号不能为空！")
                                        return
                                    }
                                    if (!vm.password) {
                                        Toast.error("密码不能为空！")
                                        return
                                    }
                                    let fullPhone = vm.username
                                    if (vm.username.length == 11 && vm.username.substring(0,1) === "1") {
                                        fullPhone = `0086${vm.username}`
                                    }else {
                                        if(vm.username.startsWith("+") ) {
                                            fullPhone = `00${vm.username.substring(1)}`
                                        }else if(!vm.username.startsWith("00")) {
                                            fullPhone = `00${vm.username}`
                                        }
                                    }
                                    vm.requestLoginWithUsernameAndPwd(fullPhone, vm.password).catch((err) => {
                                        Toast.error(err.msg)
                                    })
                                }}>登录</Button>
                            </div>
                            <div className="wk-login-content-form-others">
                                <div className="wk-login-content-form-scanlogin" onClick={() => {
                                    vm.loginType = LoginType.qrcode
                                }}>
                                    扫描登录
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className={classNames("wk-login-content-scanlogin", vm.loginType === LoginType.qrcode ? "wk-login-content-scanlogin-show" : undefined)}>
                        <Spin size="large" spinning={vm.qrcodeLoading}>
                            <div className="wk-login-content-scanlogin-qrcode">
                                {
                                    vm.qrcodeLoading || !vm.qrcode ? undefined : <QRCode value={vm.qrcode} size={280} fgColor={WKApp.config.themeColor}></QRCode>
                                }
                                {
                                    <div className={classNames("wk-login-content-scanlogin-qrcode-avatar", vm.showAvatar() ? "wk-login-content-scanlogin-qrcode-avatar-show" : undefined)}>
                                        {vm.showAvatar() ? <img src={WKApp.shared.avatarUser(vm.uid!)}></img> : undefined}
                                    </div>
                                }
                                {
                                    !vm.autoRefresh ? <div className="wk-login-content-scanlogin-qrcode-expire">
                                        <p>二维码已失效，点击刷新</p>
                                        <img onClick={() => {
                                            vm.reStartAdvance()
                                        }} src={require("./assets/refresh.png").default}></img>
                                    </div> : undefined
                                }
                            </div>
                        </Spin>
                        <div className="wk-login-content-scanlogin-qrcode-title">
                            <h3>使用手机{WKApp.config.appName}扫码登录</h3>
                        </div>
                        <div className="wk-login-content-scanlogin-qrcode-desc">
                            <ul>
                                <li>
                                    在手机上打开{WKApp.config.appName}
                                </li>
                                <li>
                                    进入 <b>消息</b> &nbsp; &gt; &nbsp; <b>+</b>  &nbsp; &gt; &nbsp;<b>扫一扫</b>
                                </li>
                                <li>
                                    将你的手机摄像头对准上面二维码进行扫描
                                </li>
                                <li>
                                    在手机上确认登录
                                </li>
                            </ul>
                        </div>
                        <div className="wk-login-footer-buttons">
                            <button onClick={() => {
                                vm.loginType = LoginType.phone
                            }}>使用手机号登录</button>
                        </div>

                    </div>

                    {/* <div className="wk-login-footer">
                        <ul>
                            <li>注册唐僧叨叨</li>
                            <li>忘记密码</li>
                            <li>隐私政策</li>
                            <li>用户协议</li>
                            <li> © 上海信必达网络科技有限公司</li>
                        </ul>

                    </div> */}
                </div>


            </div>
        }}>

        </Provider>
    }
}

export default Login