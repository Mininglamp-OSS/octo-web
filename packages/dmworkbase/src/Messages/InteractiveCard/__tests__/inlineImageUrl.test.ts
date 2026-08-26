// 内联图片 data URL 白名单：仅 image/svg+xml，且 URL 字面量与 SVG 源双层校验。

import { describe, expect, it } from "vitest";
import {
  MAX_INLINE_IMAGE_DATA_URL_LENGTH,
  isSafeInlineImageDataUrl,
} from "../sdk/inlineImageUrl";

/** 把 SVG 源编码成 percent-encoded data URL（与服务端模板产物同形）。 */
function svgDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** 生产模板实际下发的 chevron-down（附件卡片原文，逐字节复制）。 */
const CHEVRON_DOWN =
  "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%221em%22%20height%3D%221em%22%20viewBox%3D%220%200%2024%2024%22%3E%3Cpath%20fill%3D%22none%22%20stroke%3D%22%23a1a6ab%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%222%22%20d%3D%22m6%209l6%206l6-6%22%2F%3E%3C%2Fsvg%3E";

describe("isSafeInlineImageDataUrl — 放行", () => {
  it("生产模板的 chevron data URL 通过", () => {
    expect(isSafeInlineImageDataUrl(CHEVRON_DOWN)).toBe(true);
  });

  it("带 charset 参数 / base64 编码均通过", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>';
    expect(
      isSafeInlineImageDataUrl(
        `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
      )
    ).toBe(true);
    expect(
      isSafeInlineImageDataUrl(
        `data:image/svg+xml;base64,${btoa(svg)}` // base64 不含 URL 危险字符
      )
    ).toBe(true);
  });

  it("MIME 大小写不敏感", () => {
    expect(
      isSafeInlineImageDataUrl(
        `DATA:IMAGE/SVG+XML,${encodeURIComponent("<svg/>")}`
      )
    ).toBe(true);
  });
});

describe("isSafeInlineImageDataUrl — MIME 白名单（服务端仅开 svg+xml）", () => {
  it.each([
    ["data:image/png;base64,iVBORw0KGgo=", "位图 png"],
    ["data:image/gif;base64,R0lGODlhAQABAAAAACw=", "位图 gif"],
    ["data:image/webp;base64,UklGRgA=", "位图 webp"],
    ["data:text/html,%3Ch1%3Ex%3C%2Fh1%3E", "text/html"],
    ["data:application/javascript,alert(1)", "js"],
    ["data:,%3Csvg%2F%3E", "空 MIME"],
    ["data:image/svg+xmlx,%3Csvg%2F%3E", "MIME 后缀污染"],
    ["data:image/svg%2bxml,%3Csvg%2F%3E", "MIME 本身被编码"],
  ])("%s（%s）被拒", (url) => {
    expect(isSafeInlineImageDataUrl(url)).toBe(false);
  });

  it("非 data: scheme 一律走别处判断，此函数拒绝", () => {
    expect(isSafeInlineImageDataUrl("https://cdn/a.svg")).toBe(false);
    expect(isSafeInlineImageDataUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeInlineImageDataUrl("")).toBe(false);
  });
});

describe("isSafeInlineImageDataUrl — URL 字面量危险字符", () => {
  // backgroundImage 会被 SDK 拼进 CSS url('…')；引号/括号/反斜杠/空白可逃逸出该上下文。
  it.each([
    [`data:image/svg+xml,<svg xmlns='x'/>`, "单引号"],
    [`data:image/svg+xml,<svg xmlns="x"/>`, "双引号"],
    ["data:image/svg+xml,<svg/>)", "右括号"],
    ["data:image/svg+xml,<svg (/>", "左括号"],
    ["data:image/svg+xml,<svg\\/>", "反斜杠"],
    ["data:image/svg+xml,<svg />", "空格"],
    ["data:image/svg+xml,<svg\n/>", "换行"],
    ["data:image/svg+xml,<svg\t/>", "制表符"],
  ])("%s（%s）被拒", (url) => {
    expect(isSafeInlineImageDataUrl(url)).toBe(false);
  });
});

describe("isSafeInlineImageDataUrl — SVG 源内容（decode 后）", () => {
  it.each([
    [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      "script 标签",
    ],
    [
      "<svg><foreignObject><body>x</body></foreignObject></svg>",
      "foreignObject",
    ],
    ['<svg><iframe src="//evil"/></svg>', "iframe"],
    ['<svg><use href="//evil/x.svg#a"/></svg>', "use 外部引用"],
    ['<svg><image href="//evil/track.png"/></svg>', "image 外部位图"],
    ['<svg onload="alert(1)"/>', "事件属性"],
    [
      '<svg><a href="javascript:alert(1)"><rect/></a></svg>',
      "javascript: 链接",
    ],
    ['<svg><a href="https://evil"/></svg>', "外部 href"],
    ['<!DOCTYPE svg [<!ENTITY a "b">]><svg/>', "DTD / 实体（XXE）"],
    ["<html><body>x</body></html>", "不是 SVG"],
    ["", "空 payload"],
    // 命名空间前缀：SVG 走 XML 解析，`<svg:script>` 等价于 `<script>`。
    ["<svg><svg:script>alert(1)</svg:script></svg>", "带前缀的 script"],
    [
      '<svg xmlns:x="http://www.w3.org/2000/svg"><x:script>alert(1)</x:script></svg>',
      "自定义前缀的 script",
    ],
    [
      "<svg><a:foreignObject><body/></a:foreignObject></svg>",
      "带前缀的 foreignObject",
    ],
    ['<svg><n:use href="//evil/x.svg#a"/></svg>', "带前缀的 use"],
    ['<svg><n:image href="//evil/t.png"/></svg>', "带前缀的 image"],
    // XML 字符实体：属性值里可编码绕过关键词匹配（`&#106;avascript:`）。
    [
      '<svg><a href="&#106;avascript:alert(1)">x</a></svg>',
      "实体编码的 javascript:",
    ],
    ['<svg><a href="&#104;ttps://evil">x</a></svg>', "实体编码的外部 href"],
    ['<svg><a ev:onload="alert(1)"/></svg>', "带前缀的事件属性"],
    ['<svg><a xlink:href="#local"/></svg>', "任何 href 属性（图标不需要）"],
  ])("%s（%s）被拒", (svg) => {
    expect(isSafeInlineImageDataUrl(svgDataUrl(svg))).toBe(false);
  });

  it("非 ASCII 字符被拒（保证长度上限按字节生效）", () => {
    // 未编码的多字节字符会让 url.length < UTF-8 字节数，绕过体积上限。
    expect(isSafeInlineImageDataUrl("data:image/svg+xml,<svg>中</svg>")).toBe(
      false
    );
  });

  it("URL 内的裸 \\t / \\n 被拒（浏览器会剥除，可用于拆散关键词）", () => {
    expect(
      isSafeInlineImageDataUrl("data:image/svg+xml,<svg>%3Cscr\tipt%3E</svg>")
    ).toBe(false);
  });
});

// 以下三组回归自 PR #1300 的评审：每条都是评审提出、我实测确认能通过旧实现的向量。
describe("isSafeInlineImageDataUrl — 文档根必须是 SVG", () => {
  it.each([
    ["<html><body><svg/></body></html>", "wrapper 文档里藏 svg"],
    ["<html><svg/></html>", "html 根"],
    ["x<svg/>", "根前有文本"],
    ["<foo><svg/></foo>", "任意元素根"],
  ])("%s（%s）被拒", (svg) => {
    expect(isSafeInlineImageDataUrl(svgDataUrl(svg))).toBe(false);
  });

  it.each([
    ['<?xml version="1.0" encoding="UTF-8"?><svg xmlns="x"/>', "XML 声明前导"],
    ["<!-- icon: chevron --><svg xmlns=x/>", "注释前导"],
    ["   <svg xmlns=x/>", "空白前导"],
    ["<?xml version=1.0?><!-- c --> <svg xmlns=x/>", "声明+注释+空白混合"],
  ])("%s（%s）放行", (svg) => {
    expect(isSafeInlineImageDataUrl(svgDataUrl(svg))).toBe(true);
  });

  it("未闭合的前导注释不能吞掉根判定", () => {
    expect(isSafeInlineImageDataUrl(svgDataUrl("<!-- <svg/>"))).toBe(false);
  });
});

describe("isSafeInlineImageDataUrl — 非 ASCII 命名空间前缀", () => {
  // JS 的 \w 只含 ASCII，而 XML NameStartChar 允许 ñ 这类字符，
  // `<ñ:script>` 与 `<script>` 等价。ASCII 前缀早已被拦，非 ASCII 变体曾漏网。
  it.each([
    ["<svg xmlns=x xmlns:ñ=x><ñ:script>alert`1`</ñ:script></svg>", "ñ:script"],
    ["<svg xmlns=x><日:foreignObject/></svg>", "中日文前缀 foreignObject"],
    ["<svg xmlns=x><ñ:use/></svg>", "ñ:use"],
  ])("%s（%s）被拒", (svg) => {
    expect(isSafeInlineImageDataUrl(svgDataUrl(svg))).toBe(false);
  });
});

describe("isSafeInlineImageDataUrl — 属性合成与外部引用", () => {
  it.each([
    // SMIL：attributeName 指向事件/链接属性，从不写出字面 `on…=`
    [
      "<svg xmlns=x><set attributeName=onload to=alert`1`/></svg>",
      "set → onload",
    ],
    [
      '<svg xmlns=x><animate attributeName="onbegin" to="x"/></svg>',
      "animate → onbegin",
    ],
    [
      '<svg xmlns=x><animateTransform attributeName="href" to="x"/></svg>',
      "animateTransform → href",
    ],
    // CSS 外部引用
    ["<svg xmlns=x><style>@import //evil/x.css;</style></svg>", "@import"],
    [
      "<svg xmlns=x><style>rect{fill:url%23x}</style></svg>".replace(
        "url%23x",
        "url(https://evil/a.png)"
      ),
      "css url(https:)",
    ],
    // 外部内容元素
    ["<svg xmlns=x><object data=//evil/></svg>", "object"],
    ["<svg xmlns=x><embed src=//evil/></svg>", "embed"],
    ["<svg xmlns=x><link rel=stylesheet href=//evil/></svg>", "link"],
  ])("%s（%s）被拒", (svg) => {
    expect(isSafeInlineImageDataUrl(svgDataUrl(svg))).toBe(false);
  });

  it("正常动画与同文档引用不被误拒", () => {
    // attributeName 指向无害属性、url(#local) 引用同文档渐变 —— 都是图标常见写法。
    const animated =
      '<svg xmlns=x><animate attributeName="opacity" from="0" to="1"/></svg>';
    expect(isSafeInlineImageDataUrl(svgDataUrl(animated))).toBe(true);
    const localRef =
      "<svg xmlns=x><style>rect{fill:url%28%23g%29}</style></svg>";
    expect(
      isSafeInlineImageDataUrl(
        `data:image/svg+xml,${encodeURIComponent(localRef).replace(
          /%2523/g,
          "%23"
        )}`
      )
    ).toBe(true);
  });
});

describe("isSafeInlineImageDataUrl — 字节视图 vs 解析器视图", () => {
  it("UTF-16LE + ASCII 诱饵的 base64 payload 被拒", () => {
    // 注释里放码位使其 LE 字节拼出 "<svg/>"，骗过按字节扫描的根判定，
    // 真正的 <script> 被 NUL 间隔从而匹配不到任何 deny 模式。
    const decoy = "猼杶㸯"; // LE bytes: 3C 73 76 67 2F 3E
    const doc = `<!--${decoy}--><svg xmlns="x"><script>alert\`1\`</script></svg>`;
    const bytes: number[] = [];
    for (const ch of doc) {
      const c = ch.codePointAt(0) as number;
      bytes.push(c & 0xff, (c >> 8) & 0xff);
    }
    const b64 = btoa(String.fromCharCode(...bytes));
    // 前提复现：latin1 字节视图确实含诱饵、且不含 script
    const latin1 = atob(b64);
    expect(latin1.includes("<svg/>")).toBe(true);
    expect(latin1.includes("script")).toBe(false);
    // NUL 检查掐掉整类视图分歧
    expect(isSafeInlineImageDataUrl(`data:image/svg+xml;base64,${b64}`)).toBe(
      false
    );
  });

  it("percent-encoded 的 NUL 同样被拒", () => {
    expect(
      isSafeInlineImageDataUrl("data:image/svg+xml,%3Csvg%20xmlns=x%00%2F%3E")
    ).toBe(false);
  });
});

describe("isSafeInlineImageDataUrl — 生产者编码契约（P2-2，行为钉死）", () => {
  // encodeURIComponent 默认保留 !'()*，所以带括号的图标只做 encodeURIComponent 会被拒。
  // 这是有意的（layer 1 要守住 backgroundImage 的 CSS 上下文），此处把契约钉成测试：
  // 生产者必须完整编码或改用 base64。
  const ICON =
    '<svg xmlns="http://www.w3.org/2000/svg"><g transform="translate(2 2)"><path d="M0 0"/></g></svg>';

  it("仅 encodeURIComponent（残留裸括号）→ 拒", () => {
    expect(
      isSafeInlineImageDataUrl(`data:image/svg+xml,${encodeURIComponent(ICON)}`)
    ).toBe(false);
  });

  it("完整 percent-encode（含 !'()*）→ 放行", () => {
    const full = encodeURIComponent(ICON).replace(
      /[!'()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
    );
    expect(isSafeInlineImageDataUrl(`data:image/svg+xml,${full}`)).toBe(true);
  });

  it("base64 → 放行", () => {
    expect(
      isSafeInlineImageDataUrl(`data:image/svg+xml;base64,${btoa(ICON)}`)
    ).toBe(true);
  });
});

describe("isSafeInlineImageDataUrl — base64 参数位置", () => {
  it("base64 非末位被拒（浏览器会 percent-decode，我们会 atob，两侧字节不一致）", () => {
    expect(
      isSafeInlineImageDataUrl(
        "data:image/svg+xml;base64;charset=utf-8,PHN2Zy8+"
      )
    ).toBe(false);
  });

  it("base64 重复出现被拒", () => {
    expect(
      isSafeInlineImageDataUrl("data:image/svg+xml;base64;base64,PHN2Zy8+")
    ).toBe(false);
  });

  it("charset 在前、base64 末位 → 放行", () => {
    expect(
      isSafeInlineImageDataUrl(
        `data:image/svg+xml;charset=utf-8;base64,${btoa('<svg xmlns="x"/>')}`
      )
    ).toBe(true);
  });
});

describe("isSafeInlineImageDataUrl — 编码与参数（decode 前后）", () => {
  it("base64 形的恶意 SVG 同样被拒（解码后再检查）", () => {
    const evil = btoa("<svg onload=alert(1)/>");
    expect(isSafeInlineImageDataUrl(`data:image/svg+xml;base64,${evil}`)).toBe(
      false
    );
  });

  it("损坏的编码（非法 percent / 非法 base64）被拒", () => {
    expect(isSafeInlineImageDataUrl("data:image/svg+xml,%ZZ")).toBe(false);
    expect(isSafeInlineImageDataUrl("data:image/svg+xml;base64,!!!")).toBe(
      false
    );
  });

  it("未知 data URL 参数被拒", () => {
    expect(
      isSafeInlineImageDataUrl(
        `data:image/svg+xml;charset=utf-16,${encodeURIComponent("<svg/>")}`
      )
    ).toBe(false);
  });
});

describe("isSafeInlineImageDataUrl — 体积上限", () => {
  it("超长 data URL 被拒（防 payload 膨胀）", () => {
    const filler = "0".repeat(MAX_INLINE_IMAGE_DATA_URL_LENGTH);
    const url = svgDataUrl(`<svg><path d="${filler}"/></svg>`);
    expect(url.length).toBeGreaterThan(MAX_INLINE_IMAGE_DATA_URL_LENGTH);
    expect(isSafeInlineImageDataUrl(url)).toBe(false);
  });

  it("恰好达到上限的 data URL 仍通过", () => {
    const head = svgDataUrl("<svg><path d=/></svg>");
    // path 数据里补到刚好等于上限（encodeURIComponent 不转义数字，1 字符 = 1 字节）。
    const pad = "0".repeat(MAX_INLINE_IMAGE_DATA_URL_LENGTH - head.length);
    const url = head.replace("d%3D", `d%3D${pad}`);
    expect(url.length).toBe(MAX_INLINE_IMAGE_DATA_URL_LENGTH);
    expect(isSafeInlineImageDataUrl(url)).toBe(true);
  });
});
