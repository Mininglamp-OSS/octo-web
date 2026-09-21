import moment from "moment";
import { i18n, t } from "../i18n/instance";

/**
* 对Date的扩展，将 Date 转化为指定格式的String。
*
*  月(M)、日(d)、小时(h)、分(m)、秒(s)、季度(q) 可以用 1-2 个占位符，
*  年(y)可以用 1-4 个占位符，毫秒(S)只能用 1 个占位符(是 1-3 位的数字)。
*
*  【示例】：
*  common.formatDate(new Date(), 'yyyy-MM-dd hh:mm:ss.S') ==> 2006-07-02 08:09:04.423
*  common.formatDate(new Date(), 'yyyy-M-d h:m:s.S')      ==> 2006-7-2 8:9:4.18
*  common.formatDate(new Date(), 'hh:mm:ss.S')            ==> 08:09:04.423
*  
*  @author 即时通讯网([url=http://www.52im.net]http://www.52im.net[/url])
*/
const _formatDate = function (date:Date, fmt:string) {
    const o:any = {
        "M+": date.getMonth() + 1, //月份
        "d+": date.getDate(), //日
        "h+": date.getHours(), //小时
        "m+": date.getMinutes(), //分
        "s+": date.getSeconds(), //秒
        "q+": Math.floor((date.getMonth() + 3) / 3), //季度
        "S": date.getMilliseconds() //毫秒
    };
    if (/(y+)/.test(fmt)) fmt = fmt.replace(RegExp.$1, (date.getFullYear() + "").substr(4 - RegExp.$1.length));
    for (const k in o)
        if (new RegExp("(" + k + ")").test(fmt)) fmt = fmt.replace(RegExp.$1, (RegExp.$1.length === 1) ? (o[k]) : (("00" + o[k]).substr(("" + o[k]).length)));
    return fmt;
};

function formatCalendarDate(date: Date) {
    if (i18n.getLocale() === "zh-CN") {
        return _formatDate(date, "yyyy/M/d");
    }
    return new Intl.DateTimeFormat(i18n.getLocale(), {
        day: "numeric",
        month: "numeric",
        year: "numeric",
    }).format(date);
}

function formatShortWeekday(date: Date) {
    return new Intl.DateTimeFormat(i18n.getLocale(), { weekday: "short" }).format(date);
}

/**
* 仿照微信中的消息时间显示逻辑，将时间戳（单位：毫秒）转换为友好的显示格式.
*
* 1）7天之内的日期显示逻辑是：今天、昨天(-1d)、前天(-2d)、星期？（只显示总计7天之内的星期数，即<=-4d）；
* 2）7天之外（即>7天）的逻辑：直接显示完整日期时间。
*
* @param  {[long]} timestamp 时间戳（单位：毫秒），形如：1550789954260
* @param {boolean} mustIncludeTime true表示输出的格式里一定会包含“时间:分钟”
* ，否则不包含（参考微信，不包含时分的情况，用于首页“消息”中显示时）
* @param {boolean} [compact=false] 只由窄容器 (会话列表 date 列, 见 WS-216 /
* GitHub #1629) 传入 true。**只影响 -2d 桶的文案选择**:compact 时读
* `.dayBeforeYesterdayShort` (en-US `2d ago`),默认读 `.dayBeforeYesterday`
* (en-US `The day before yesterday`),从而不让"2d ago"外溢到 MergeforwardMessageList
* / GlobalSearch / ThreadCreated。
*
* 注意:一周内 weekday 桶用短版本 (`Wed` / `周三`) 是**全局的、故意的**,
* 不受 compact 控制 —— 与 `formatMessageTimestamp` (同文件, 已用 short weekday)
* 保持一致,四个 caller 都按同样的短写法渲染,避免同一时间戳在不同 UI 面出
* 两种周几表达。若日后需要按 caller 差异化 weekday,再把它也挂到 compact 上。
*
* 布局耦合:时分后缀恒用 24 小时格式 `hh:mm` (见 `timeExtraStr` 的 `_formatDate`
* 调用);会话列表 `.wk-conversationlist-item-time { max-width: 112px }` 就是按
* 最长 24h 标签 `12/31/2025 23:59` (~95px 实测) 定的。若日后本 helper 或某个
* caller 换 12h (`hh:mm A`),`12/31/2025 11:59 PM` 会撑破 cap,那时 layout
* 上限得跟着调。
*
* @return {string} 输出格式形如：“刚刚”、“10:30”、“昨天 12:04”、“前天 20:51”、“周二”、“2019/2/21 12:09”等形式
* @author 即时通讯网([url=http://www.52im.net]http://www.52im.net[/url])
* @since 1.1
*/
export function getTimeStringAutoShort2(timestamp:number, mustIncludeTime:boolean, compact:boolean = false) {

    // 当前时间
    const currentDate = new Date();
    // 目标判断时间
    const srcDate = new Date(timestamp);

    const currentYear = currentDate.getFullYear();
    const currentMonth = (currentDate.getMonth() + 1);
    const currentDateD = currentDate.getDate();

    const srcYear = srcDate.getFullYear();
    const srcMonth = (srcDate.getMonth() + 1);
    const srcDateD = srcDate.getDate();

    let ret = "";

    // 要额外显示的时间分钟
    const timeExtraStr = (mustIncludeTime ? " " + _formatDate(srcDate, "hh:mm") : "");

    // 当年
    if (currentYear === srcYear) {
        const currentTimestamp = currentDate.getTime();
        const srcTimestamp = timestamp;
        // 相差时间（单位：毫秒）
        const deltaTime = (currentTimestamp - srcTimestamp);

        // 当天（月份和日期一致才是）
        if (currentMonth === srcMonth && currentDateD === srcDateD) {
            // 时间相差60秒以内
            if (deltaTime < 60 * 1000)
                ret = t("base.time.justNow");
            // 否则当天其它时间段的，直接显示“时:分”的形式
            else
                ret = _formatDate(srcDate, "hh:mm");
        }
        // 当年 && 当天之外的时间（即昨天及以前的时间）
        else {
            // 昨天（以”现在”的时候为基准-1天）
            const yesterdayDate = new Date();
            yesterdayDate.setDate(yesterdayDate.getDate() - 1);

            // 前天（以”现在”的时候为基准-2天）
            const beforeYesterdayDate = new Date();
            beforeYesterdayDate.setDate(beforeYesterdayDate.getDate() - 2);

            // 用目标日期的“月”和“天”跟上方计算出来的“昨天”进行比较，是最为准确的（如果用时间戳差值
            // 的形式，是不准确的，比如：现在时刻是2019年02月22日1:00、而srcDate是2019年02月21日23:00，
            // 这两者间只相差2小时，直接用“deltaTime/(3600 * 1000)” > 24小时来判断是否昨天，就完全是扯蛋的逻辑了）
            if (srcMonth === (yesterdayDate.getMonth() + 1) && srcDateD === yesterdayDate.getDate())
                ret = t("base.time.yesterday") + timeExtraStr;// -1d
            // “前天”判断逻辑同上;窄容器 (compact=true) 走 `.dayBeforeYesterdayShort`
            // (en-US `2d ago`),不动其它 3 个共享 caller 的英文原语,避免"2d ago"
            // 外溢到 MergeforwardMessageList / GlobalSearch / ThreadCreated。
            // t() 拆到 ternary 外面,scripts/i18n-scan.mjs 才能静态识别两个 key
            // (它只认第一参数是字符串字面量的 t() 调用)。
            else if (srcMonth === (beforeYesterdayDate.getMonth() + 1) && srcDateD === beforeYesterdayDate.getDate())
                ret = (compact ? t("base.time.dayBeforeYesterdayShort") : t("base.time.dayBeforeYesterday")) + timeExtraStr;// -2d
            else {
                // 跟当前时间相差的小时数
                const deltaHour = (deltaTime / (3600 * 1000));

                // 如果小于或等 7*24小时就显示星期几
                if (deltaHour <= 7 * 24) {
                    // 取出当前是星期几。用 short weekday (`Wed` / `周三`) 是**全局的
                    // 故意行为**,不受 compact 控制 —— 与 formatMessageTimestamp (同
                    // 文件,已用 short weekday) 对齐,四个 caller 都按同一份短写法
                    // 渲染。若日后需要按 caller 差异化 weekday,再挂 compact。
                    const weedayDesc = formatShortWeekday(srcDate);
                    ret = weedayDesc + timeExtraStr;
                }
                // 否则直接显示完整日期时间
                else
                    ret = formatCalendarDate(srcDate) + timeExtraStr;
            }
        }
    }
    // 往年
    else {
        ret = formatCalendarDate(srcDate) + timeExtraStr;
    }

    return ret;
};

export function dateFormat(date:Date, fmt:string) {

    return _formatDate(date,fmt)
}

/**
 * 格式化聊天消息行时间。
 *
 * 对齐新 MessageRow 现有规则：
 * - 今天：HH:mm
 * - 昨天：昨天 HH:mm
 * - 一周内：周X HH:mm
 * - 今年：MM-DD HH:mm
 * - 跨年：YYYY-MM-DD HH:mm
 */
export function formatMessageTimestamp(timestamp: number): string {
    const ms = timestamp < 10000000000 ? timestamp * 1000 : timestamp
    const now = Date.now()
    const diff = now - ms

    if (diff < 86400 * 1000 && moment(ms).isSame(moment(), "day")) {
        return moment(ms).format("HH:mm")
    }

    if (diff < 86400 * 2000 && moment(ms).isSame(moment().subtract(1, "day"), "day")) {
        return t("base.time.yesterdayWithTime", {
            values: { time: moment(ms).format("HH:mm") },
        })
    }

    if (diff < 86400 * 7000) {
        return `${formatShortWeekday(new Date(ms))} ${moment(ms).format("HH:mm")}`
    }

    if (moment(ms).isSame(moment(), "year")) {
        return moment(ms).format("MM-DD HH:mm")
    }

    return moment(ms).format("YYYY-MM-DD HH:mm")
}

export function formatRelativeTime(dateStr?: string): string {
    if (!dateStr) return ""
    const date = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (minutes < 1) return t("base.time.justNow")
    if (minutes < 60) return i18n.format.relativeTime(-minutes, "minute")
    if (hours < 24) return i18n.format.relativeTime(-hours, "hour")
    if (days < 7) return i18n.format.relativeTime(-days, "day")
    return new Intl.DateTimeFormat(i18n.getLocale()).format(date)
}
