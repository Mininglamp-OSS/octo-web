// 本文件只保留页面实际使用的工具函数。
// 历史遗留的 invoke / invokeIOS / isIOS / isAndroid / showConversation /
// pop / closeWebView / $.postJSON 已删除：native 桥接一律走 IMJSBridge.js，
// 而 isIOS() 恒为 true，使 invoke() 在任何非 iOS 环境都会解引用
// window.WKJSBridge 抛 TypeError。它们此前作为公开静态资源随页面发布，
// 看起来可调用但没有原生宿主，属于有坑的死接口。

function getQueryString(name) {
    var reg = new RegExp("(^|&)" + name + "=([^&]*)(&|$)");
    var r = window.location.search.substr(1).match(reg);
    if (r != null) return unescape(r[2]); return null;
}

function uuid() {
    var s = [];
    var hexDigits = "0123456789abcdef";
    for (var i = 0; i < 36; i++) {
        s[i] = hexDigits.substr(Math.floor(Math.random() * 0x10), 1);
    }
    s[14] = "4"; // bits 12-15 of the time_hi_and_version field to 0010
    s[19] = hexDigits.substr((Math.random() * 0x10 | 0x8) & 0xf, 1); // RFC4122 variant nibble
    s[8] = s[13] = s[18] = s[23] = "-";

    var uuid = s.join("");
    return uuid;
}
