
window.im = {}
// 配置
window.limconfig = {};
// 错误回调函数
window.errCallbackFunc;

//iOS  注册事件监听
function setupWebViewJavascriptBridge(callback) {

    if (window.WebViewJavascriptBridge) {
        return callback(WebViewJavascriptBridge);
    }
    if (window.WVJBCallbacks) {
        return window.WVJBCallbacks.push(callback);
    }
    window.WVJBCallbacks = [callback];
    var WVJBIframe = document.createElement('iframe');
    WVJBIframe.style.display = 'none';
    WVJBIframe.src = 'https://__bridge_loaded__';
    document.documentElement.appendChild(WVJBIframe);
    setTimeout(function () {
        document.documentElement.removeChild(WVJBIframe)
    }, 0)
}


//android 注册事件监听
function connectWebViewJavascriptBridge(callback) {

    if (window.WebViewJavascriptBridge) {
        callback(WebViewJavascriptBridge)
    } else {
        document.addEventListener(
            'WebViewJavascriptBridgeReady'
            , function () {
                callback(WebViewJavascriptBridge)
            },
            false
        );
    }
}

/**
通过config接口注入权限验证配置
所有需要使用JS-SDK的页面必须先注入配置信息，否则将无法调用
（同一个url仅需调用一次，对于变化url的SPA的web app可在每次url变化时进行调用）。
**/
im.config = function (cfg) {
    window.limconfig = cfg;
}
im.onError = function (errFunc) {
    window.errCallbackFunc = errFunc;
}

/**
 *  初始化
 * @param {*} callback
 */
im.onReady = function (callback) {
    // 两条路径（iOS iframe / Android ready 事件）都可能注入 bridge，且都可以在
    // 调用时立即拿到已存在的 window.WebViewJavascriptBridge。没有该标志位时
    // callback 会被调两次，第二个 bridge 也会静默覆盖第一个。只让先到者生效。
    //
    // init 也必须在这道门之内：原生壳预注入 bridge 时两条路径都会同步命中，
    // 若在守门之外对已被收养的 bridge 调 init，会抛（WebViewJavascriptBridge
    // "init called twice" 或自定义壳的 "bridge.init is not a function"），
    // 异常会冲出 onReady —— 而它是各页 DOM-ready 的第一条语句，后面整段初始化
    // （session resolve / 错误横幅 / 分类加载 / 事件绑定）全部作废且无提示。
    var ready = false;
    function onBridge(bridge) {
        if (ready) {
            return;
        }
        ready = true;
        try {
            if (bridge && typeof bridge.init === 'function') {
                bridge.init(function (message, responseCallback) {
                    responseCallback();
                });
            }
        } catch (e) {
            // 已经 init 过的实现会抛；bridge 本身仍可用，不要中断调用方。
        }
        window.IMJSBridge = bridge
        if (callback) {
            callback()
        }
    }

    setupWebViewJavascriptBridge(onBridge)

    connectWebViewJavascriptBridge(onBridge)
}


/**
  调用方法
  method: 方法名
  options 参数
  successCallback: 成功回调
  errorCallback：错误回调
  completeCallback: 完成回调
**/
im.call = function (method, params) {
    if (window.IMJSBridge) {
        window.IMJSBridge.callHandler(method, params ? params.options : undefined, function (response) {
            let result
            try {
                result = JSON.parse(response)
            } catch (e) {
                // A malformed native payload must not throw out of the callback:
                // none of success / error / complete would fire and every caller
                // awaiting this would hang. Route it through the error path with
                // the same shape the no-bridge branch uses.
                result = { err_code: 500, msg: 'IMJSBridge returned invalid JSON' }
                if (params && params.error) {
                    params.error(result)
                }
                if (params && params.complete) {
                    params.complete(result)
                }
                return
            }
            if (result.err_code == undefined || result.err_code == 200) { // 正确请求
                if (params.success) {
                    params.success(result)
                }
            } else {
                // 错误
                if (params.error) {
                    params.error(result)
                }
            }
            // 完成
            if (params.complete) {
                params.complete(result)
            }
        })
    } else if (params) {
        // 没有原生 bridge（非 App 环境，或 onReady 尚未注入）：必须回调，
        // 否则 im.getChannel() 之类的 Promise 会永久挂起。
        var result = { err_code: 500, msg: 'IMJSBridge is not available' }
        if (params.error) {
            params.error(result)
        }
        if (params.complete) {
            params.complete(result)
        }
    }
}

// ---------- 常用函数 ----------

// 退出 webview。bridge 不存在时 im.call 走 no-bridge 分支并回调 error，
// 所以必须传 params，否则按钮会变成无反馈的空操作。
//
// fallback 绝对不能是 history.back()：成功页是 report.html 用
// window.location.href 跳过来的，而那次跳转前已经用 replaceState 把
// 一次性 ?session 从 URL 抹掉了；back 回去只会重跑 report.html 并命中
// onAuthResolveFailed()，让刚提交完的用户看到“登录态获取失败”的假错误。
// 改为交给调用方决定：优先 window.close()，关不掉就显示可见提示。
im.quit = function (onUnavailable) {
    var handled = false;
    function fallback() {
        if (handled) {
            return;
        }
        handled = true;
        if (typeof onUnavailable === 'function') {
            onUnavailable();
            return;
        }
        // 没有调用方兜底时也不回头：只尝试关窗，并把选择权留给用户。
        try {
            window.close();
        } catch (e) { /* 非脚本打开的窗口关不掉，忽略 */ }
    }
    // bridge 存在但永不回调 quit 时，error/complete 都不会触发，
    // 按钮会永久无反应（且连提示也不出）。与 getChannel 一样加限时。
    var timer = setTimeout(fallback, 3000);
    im.call("quit", {
        error: function () { clearTimeout(timer); fallback(); },
        complete: function (result) {
            clearTimeout(timer);
            if (result && result.err_code && result.err_code !== 200) {
                fallback();
            }
        }
    });
}

// 获取频道信息
im.getChannel = function () {
    return new Promise(function (resolve, reject) {
        im.call("getChannel", {
            success: function (channel) {
                resolve(channel);
            },
            error: function (result) {
                reject(result);
            }
        });
    });
}


// 显示最近会话
im.showConversation = function (channelID, channelType) {
    im.call("showConversation", {
        options: {
            'forward': 'replace',
            'channel_id': channelID,
            'channel_type': channelType
        }
    })
}