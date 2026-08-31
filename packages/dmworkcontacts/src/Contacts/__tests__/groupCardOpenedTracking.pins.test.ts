import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// group_card_opened 埋点覆盖点(源码层钉,沿用 dmworkbase dapEventCoverage.pins 的做法):
// Contacts 组件挂载依赖极重的 transitive 图(WKApp/WKSDK/虚拟列表…),headless 渲染成本过高,
// 故在源码层锁定关键行 —— 通讯录内点群行弹群名片 = handleGroupClick 命令式发 group_card_opened,
// object_id=原始 group_no。防止后续改动悄悄把发点删掉或改口径而无人察觉。

const contactsSrc = fs.readFileSync(
  path.join(__dirname, "..", "index.tsx"),
  "utf8"
);

describe("group_card_opened — 通讯录群名片打开采集(命令式)", () => {
  it("handleGroupClick 命令式发 group_card_opened,object_id=原始 group_no", () => {
    expect(contactsSrc).toMatch(
      /Dap\.shared\.track\(\s*['"]group_card_opened['"],\s*\{\s*object_id:\s*groupNo\s*\}/
    );
  });

  it("发点在 handleGroupClick 内(弹卡片的唯一收口点)", () => {
    const m = contactsSrc.match(
      /private handleGroupClick =[\s\S]*?\n {4}\}/
    );
    expect(m).not.toBeNull();
    expect(m![0]).toMatch(/Dap\.shared\.track\(\s*['"]group_card_opened['"]/);
  });
});
