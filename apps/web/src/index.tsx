import React from 'react';
import ReactDOM from 'react-dom';
import '@octo/base/src/theme/tokens.css';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import  { BaseModule, WKApp } from '@octo/base';
import  { LoginModule } from '@octo/login';
import  { DataSourceModule } from '@octo/datasource';
import {ContactsModule} from '@octo/contacts';

const apiURL = import.meta.env.VITE_API_URL || "https://api.example.com/v1/"

if((window as any).__TAURI_IPC__) { // tauri环境
  WKApp.apiClient.config.apiURL = apiURL
}else if((window as any)?.__POWERED_ELECTRON__){
  WKApp.apiClient.config.apiURL = apiURL
}else{
  if(import.meta.env.DEV) {
    WKApp.apiClient.config.apiURL = apiURL
  }else {
    WKApp.apiClient.config.apiURL = "/api/v1/" // 正式环境地址 (通用打包镜像，用此相对地址),打包出来的镜像可以通过API_URL环境变量来修改API地址
  }
}

WKApp.apiClient.config.tokenCallback = ()=> {
  return WKApp.loginInfo.token
}
WKApp.config.appVersion = `${import.meta.env.VITE_VERSION || "0.0.0"}`
WKApp.config.appName = "Octo"

WKApp.loginInfo.load() // 加载登录信息

WKApp.shared.registerModule(new BaseModule()); // 基础模块
WKApp.shared.registerModule(new DataSourceModule()) // 数据源模块
WKApp.shared.registerModule(new LoginModule()); // 登录模块
WKApp.shared.registerModule(new ContactsModule()); // 联系模块

WKApp.shared.startup() // app启动

// Initialize Electron notification bridge if running in Electron

ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById('root')
);
reportWebVitals();

