import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import  { BaseModule, WKApp } from '@tsdaodao/base';
import  { LoginModule } from '@tsdaodao/login';
import  { DataSourceModule } from '@tsdaodao/datasource';
import {ContactsModule} from '@tsdaodao/contacts';


WKApp.apiClient.config.apiURL = "https://chatapi.githubim.com/v1/"
// WKApp.apiClient.config.apiURL = "/api/v1/" // 正式环境地址 (通用打包镜像，用此相对地址)
WKApp.apiClient.config.tokenCallback = ()=> {
  return WKApp.loginInfo.token
}
WKApp.config.appVersion = `${process.env.REACT_APP_VERSION || "0.0.0"}`

WKApp.loginInfo.load() // 加载登录信息

WKApp.shared.registerModule(new BaseModule()); // 基础模块
WKApp.shared.registerModule(new DataSourceModule()) // 数据源模块
WKApp.shared.registerModule(new LoginModule()); // 登录模块
WKApp.shared.registerModule(new ContactsModule()); // 联系模块

WKApp.shared.startup() // app启动


ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById('root')
);
reportWebVitals();

