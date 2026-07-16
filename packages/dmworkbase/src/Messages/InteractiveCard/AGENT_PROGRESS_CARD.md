# `agent_progress_v1` 推理过程卡 — 生产者结构契约

> 面向**卡片生产者**(reasoning bot)。前端只对**精确匹配本结构**的 AC JSON 施加
> 「推理过程卡」布局样式;结构不符时选择器静默落空、退化成普通卡。样式权威是
> 同目录 `index.css` 的 `--agent-progress` 段 + `sdk/agentProgressLayout.ts` +
> `cardLayout.ts`;白名单/大小上限权威是 octo-server `pkg/cardmsg`(见
> `docs/card-protocol.md`)。本文与它们同步,若有出入以代码为准。

## 0. 消息模型(重要)

推理块和回答正文是**同一条消息**,不是两条:bot 先发出带推理块的 type-17 卡,推理完成后
**编辑这条消息**把回答结果**追加**进同一张卡(帧更新,经 `message/extra/sync` 三端重渲;
跨类型变异卡→文被禁止,编辑后仍是 type-17)。一条消息的 `body` 两帧演进:

1. **帧1(推理)**:头部 `ColumnSet` + 可折叠 `Container#timeline_detail`(见 §2)。
2. **帧2(追加结果)**:在推理块**之后**追加回答正文(`TextBlock`/`RichTextBlock`/列表等)。

> **现状 vs 目标(前端待落地,与本轮无关)**:当前前端 CSS 给**整张卡**描边(§2 结构 ——
> 头部 / `timeline_detail` 直接挂在卡根,追加的回答也在这张卡的边框内)。原型图3 的目标观感
> 是「推理块有边框、其下追加的回答纯文本无边框」—— 这需要把推理块包进一个子面板 `Container`、
> 边框只落在子面板上,属**待落地的前端重构**。在该重构落地前,生产者按 §2 现状结构下发即可;
> 届时会同步更新本文与选择器,再请生产者加包裹层。

## 1. 触发标记

顶层 `metadata.octo_layout` 必须**精确等于** `"agent_progress_v1"`:

```json
{ "type": "AdaptiveCard", "version": "1.5",
  "metadata": { "octo_layout": "agent_progress_v1" }, "body": [ ... ] }
```

`metadata` 是客户端布局提示,不参与结构校验(可安全携带)。缺失/拼错 → 前端按普通卡渲染。

## 2. body 结构契约

前端 CSS 用**直接子选择器**逐层匹配,顺序与层级必须严格如下。

### 2.1 `body[0]` 必须是头部 `ColumnSet`(两列)

| 列 | width | 内容 | 前端处理 |
|---|---|---|---|
| 列1 | `stretch` | 标题 `TextBlock`(`color:"Accent"` → 紫) + meta `TextBlock`(`isSubtle:true, size:"Small"`) | 行整体居中、底部一条分隔线 |
| 列2(末列) | `auto` | `ActionSet`,内含 `Action.ToggleVisibility` | 末列右对齐;按钮渲成**紫色 tinted 胶囊**「展开推理」 |

- 标题文本里的图标(如 `✦`)由生产者自带,属文本内容,前端不注入。
- 切换按钮 `targetElements` 同时翻转**时间轴**与**收起摘要**(见 §2.3),实现一键展开/收起。

### 2.2 折叠时间轴:`Container` 且 `id` **精确为** `"timeline_detail"`

- `isVisible:false`(默认收起),由头部按钮 toggle。
- 直接子元素两类,可混排:
  - **步骤行** = `ColumnSet`:
    - 列1 `width:"auto"` → 序号 `TextBlock`(前端自动着紫、居中,是时间轴节点)。
    - 列2 `width:"stretch"` → **必须再套一层 `Container`** 包步骤正文(`RichTextBlock`/`TextBlock`);前端给这层淡底+细边+圆角。
  - **状态/错误块**(可选)= 直接是一个带 `style` 的 `Container`(如 `"style":"attention"`)。
    `sdk/agentProgressLayout.ts` 检测到内联填充色,套 `--status`(danger)样式并清掉内联底色。
    ⚠️ **普通步骤不要设 `style`**,否则会被误判成 status 块。

### 2.3 收起摘要 `TextBlock`(推荐)

放在 `body[1]`,`id:"reasoning_summary"`、`isVisible:true`、`isSubtle:true, size:"Small"`,
如「✓ 已思考 12 秒 · 推理过程已收起」。头部按钮把它和时间轴一起翻转:收起时显示摘要、
展开时显示时间轴。

> 说明:`Action.ToggleVisibility` 无 `isVisible` 参数时是**翻转当前态**。单个按钮
> `targetElements: ["timeline_detail","reasoning_summary"]` 即可一键来回切换(时间轴与摘要
> 互斥显隐)。**局限**:按钮文案不会随之从「展开推理」变「收起」——AC ToggleVisibility 不能
> 改按钮文案。可接受固定文案,或改用图标。

## 3. 白名单与约束(octo/v1)

- 只用:`TextBlock`、`RichTextBlock`、`ColumnSet`/`Column`、`Container`、`ActionSet`、
  `Action.ToggleVisibility`。**全部在 octo/v1 白名单**,无需 octo/v2。
- `id` 帧内唯一;`timeline_detail` 的 id 必须与按钮 `targetElements` 对得上(悬空引用整卡拒)。
- 大小/结构:序列化 ≤512 KiB、节点 ≤200、深度 ≤16(`pkg/cardmsg`)。
- 隐藏子树(`isVisible:false`)照样过白名单、计入预算 —— 别把超预算内容藏进去绕过校验。
- 发送方须是 bot/webhook 身份,否则前端信任门禁降级为 plain(与本布局无关,协议要求)。

## 4. 完整可用示例(收起态)

> 这份 JSON 就是前端联调截图用的模板,结构与 §2 一一对应,可直接照抄改文案。

```json
{
  "type": "AdaptiveCard",
  "version": "1.5",
  "metadata": { "octo_layout": "agent_progress_v1" },
  "body": [
    {
      "type": "ColumnSet",
      "columns": [
        {
          "type": "Column", "width": "stretch", "verticalContentAlignment": "Center",
          "items": [
            { "type": "TextBlock", "text": "✦ 已深度思考", "weight": "Bolder", "size": "Medium", "color": "Accent" },
            { "type": "TextBlock", "text": "用时 12 秒 · 3 段推理 · 13 次工具调用", "isSubtle": true, "size": "Small", "spacing": "Small" }
          ]
        },
        {
          "type": "Column", "width": "auto", "verticalContentAlignment": "Center",
          "items": [
            { "type": "ActionSet", "actions": [
              { "type": "Action.ToggleVisibility", "title": "展开推理",
                "targetElements": ["timeline_detail", "reasoning_summary"] }
            ]}
          ]
        }
      ]
    },
    { "type": "TextBlock", "id": "reasoning_summary", "isVisible": true,
      "text": "✓ 已思考 12 秒 · 推理过程已收起", "isSubtle": true, "size": "Small", "spacing": "Medium" },
    {
      "type": "Container", "id": "timeline_detail", "isVisible": false,
      "items": [
        { "type": "ColumnSet", "columns": [
          { "type": "Column", "width": "auto", "items": [{ "type": "TextBlock", "text": "1" }] },
          { "type": "Column", "width": "stretch", "items": [
            { "type": "Container", "items": [
              { "type": "RichTextBlock", "inlines": [{ "type": "TextRun", "text": "读取 config.ts,确认渠道 B 的投放配置" }] }
            ]}
          ]}
        ]},
        { "type": "ColumnSet", "columns": [
          { "type": "Column", "width": "auto", "items": [{ "type": "TextBlock", "text": "2" }] },
          { "type": "Column", "width": "stretch", "items": [
            { "type": "Container", "items": [
              { "type": "RichTextBlock", "inlines": [{ "type": "TextRun", "text": "对比上周转化漏斗,定位中后段流失" }] }
            ]}
          ]}
        ]},
        { "type": "Container", "style": "attention", "items": [
          { "type": "RichTextBlock", "inlines": [{ "type": "TextRun", "text": "❌ 读取 metrics.csv 失败,已跳过该来源" }] }
        ]}
      ]
    }
  ]
}
```

## 5. 结构 → 样式对照(排查用)

| 生产者结构 | CSS 选择器 | 效果 |
|---|---|---|
| `body[0]` = ColumnSet | `... > .ac-columnSet:first-child` | 头部行、底部分隔线 |
| 头部列2(末列) | `... .ac-columnSet:first-child > .ac-container:last-child` | 右对齐容纳按钮 |
| 头部按钮 | `... .ac-columnSet:first-child .ac-pushButton` | 紫色 tinted 胶囊 |
| `Container#timeline_detail` | `... > #timeline_detail` | 折叠区 + 左侧时间轴竖线 |
| 步骤 ColumnSet 的列1 | `... > #timeline_detail > .ac-columnSet > .ac-container:first-child` | 紫色序号节点(16px) |
| 步骤 ColumnSet 列2 里的 Container | `... > .ac-columnSet > .ac-container:last-child > .ac-container` | 淡底+细边+圆角的步骤正文框 |
| timeline 下直接的带 style 的 Container | `.wk-interactive-card-progress-step--status`(JS 加类) | danger 状态块 |

> 自查:把 JSON 丢进前端渲染,若时间轴竖线、紫色序号、步骤正文框都出现,即结构达标;
> 若退化成一张普通卡(无竖线/无紫序号),多半是 `metadata.octo_layout` 缺失或 `body[0]`
> 不是 ColumnSet / `timeline_detail` id 写错。
