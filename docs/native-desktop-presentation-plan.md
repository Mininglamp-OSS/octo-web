# macOS 与 Windows 桌面原生外观方案：保持现有 Web 功能不变

调研日期：2026 年 9 月 10 日。
状态：本阶段源码在 Web `6989cae1` 与 Client `0a96e89` 基线上完成定向验证，准备保存为独立本地提交，默认不开启；预览制品不作为发布输入，Windows 原生桌面验收未完成。

## 实施记录

本节是实际进度，后续章节保留完整设计路线，尚未实现的增强不构成交付声明。

### 本阶段提交边界（2026 年 9 月 11 日）

- Web 已同步至 `upstream/main` 的 `6989cae1`，提交前再次 fetch，未发现新的上游提交。此次保存独立通信入口的能力协商、安全区、分区底色和拖动/浮层适配，不等待应用、通讯录和智能总结 tab 的完整沉浸式适配。
- 共享会话、搜索、预览、面板和总结页头只增加无行为的展示属性；`SummaryListPage` 的标记供消息内总结面板使用，不表示智能总结 tab 已完成适配。普通浏览器入口与旧 Electron 入口不加载桌面适配器及其 CSS。
- 本轮增加可选的 `appearance.sidebarBackground`，校验后用于列表底色；旧宿主缺少字段时回退，卸载时清理变量。桌面适配器及拖动守卫 29 项测试通过，普通 Web 构建和桌面逻辑隔离检查通过，完整浏览器业务回归仍未完成。
- 通信 mock/live 制品已在隔离目录构建，清单如实记录 `6989cae1` + dirty；Client 中用于四份本地制品联调的版本锁定不进入这次源码提交。源码提交后需从已提交版本重新构建并发布非 mock 制品，再单独更新 Client 的精确锁定，不能把此处的基线提交号当作包含本轮修改的发布版本。
- Client 保存已验证基线的本地检查点。提交核对时发现 Client 主线已到 `83cbf5d`，包含工作空间命名迁移及 UI 改动，尚未整合；合并前必须单独同步并复验。此阶段不推送、不创建 PR/MR、不发布或覆盖现有预览。

以下记录保留各轮当时的代码和制品身份；当前提交范围以上述边界为准。

### 通用拖动与浮层适配：实施范围（2026 年 9 月 11 日）

- 行为清单：不新增业务入口；现有关闭、返回、搜索、菜单及草稿保持原行为。只有显式声明的页头/布局背景可拖动，其直接业务子树统一排除拖动；任一可见浮层或侧栏存在时，暂停消息视图的标题拖动，不插入额外标题条、不重建消息视图。最后一个浮层隐藏或移除后恢复，动画及 body portal 纳入同一生命周期。
- 文件地图：`client-communication/desktopDragGuard.ts` 管理浮层可见性与拖动暂停；`desktopPresentation.ts` 负责安装/清理；桌面 CSS 负责正向声明和默认可交互。既有通用页头增加无行为的布局声明，ThreadPanel/搜索/总结等自定义面板根节点增加浮层声明，面板页头复用已有 Windows/macOS 安全区几何。
- PR 范围：只完善可选桌面展示与命中规则，不更换 WebContentsView，不迁移消息/评论/权限/路由逻辑，不重绘系统按钮，不改普通浏览器或旧 Electron 的入口。使用语义化 dialog/menu/listbox/tooltip 和公共根节点标记，不扫描 React 内部或维护关闭按钮类名黑名单。
- 验证计划：适配器单测覆盖叠加、动态 portal、隐藏、离屏、动画和卸载清理；Electron 回归覆盖真实子区关闭、任意 div 操作、浮层最后关闭后恢复、默认关闭、草稿及视图实例保留；重建普通 Web 并扫描桌面 CSS 隔离，重打非 mock 通信制品。原生鼠标验证与 DOM 测试分开记录，Windows 真机未测则明确保留缺口。

### 通用拖动与浮层适配：验证结果（2026 年 9 月 11 日）

- 桌面适配器、拖动守卫、通信壳及 readyReporter：4 个测试文件、49 项通过。既有会话/子区/聊天/搜索/右面板：7 个文件、30 项通过。守卫仅在有效桌面能力协商后安装，卸载时释放观察器、动画帧和事件监听。补测浮层隐藏但不卸载时的内部动画，以及浮层移除后仍保留的动画包装节点；两种情况均释放拖动暂停状态。
- 新增 Client `native-desktop-overlays.spec.ts` 的 6 项 Electron 回归通过，覆盖实际子区、body portal、语义浮层、隐藏节点、叠加浮层和默认关闭；检查实际计算后的 `-webkit-app-region`、草稿内容及通信视图实例不变。
- 既有 `native-desktop.spec.ts` 3 项通过；`communication.spec.ts` 首次 10/12 通过，通讯录联系人可见性和第二次模拟崩溃的 2 项单独重跑通过。保留首次失败记录，不据此宣称整套测试无波动。
- 普通 Web、mock 通信、非 mock 通信均构建成功。普通 Web 的 JS/CSS/HTML 未发现 `desktop-drag-suspended`、`--desktop-drag-region`、`getDesktopPresentation` 或 `desktop-presentation`；共享组件新增的声明属性仍允许存在。
- 最终通信产物位于 `.local-artifacts/native-desktop-20260911/drag-guard/{live,mock-final}/communication/renderer`，源码身份仍为 `3e9a5ae6` + dirty，精确匹配 Client pin。较早的 `mock` 保留供已启动的原生 QA 窗口使用；最初登录预览所用的旧制品没有覆盖。最终 live 构建发生在新预览尚未加载通信视图时，没有放宽生产制品校验。
- macOS 独立 mock 原生窗口已用坐标鼠标点击打开子区，再点击右上角 X；无障碍树确认子区移除，整窗截图确认抽屉关闭、会话宽度恢复。该项不是 Playwright DOM click 的替代命名；草稿/实例检查由上述 Electron 回归分别提供。
- 原生窗口检查曾出现截图停留在旧画面的情况；经原生窗口菜单切换到另一显示器后画面恢复，才完成上述关闭验证。此处不认定具体停绘根因，也不据此宣称遮挡恢复、多显示器或长时间运行已验收。
- 取舍：任一可见浮层出现时，暂停整个消息文档内的页头拖动；最后一层关闭后恢复。这样无需逐个识别业务按钮，但浮层打开期间不能用这些页头空白拖窗。Windows 真机命中、恢复后的原生拖窗/双击以及完整业务验收仍未完成。
- 新真实预览使用 `drag-guard/live-preview` 独立配置目录，已接入最终 live 通信制品并完成 runtime bootstrap。日志确认从 Client 自带清单安装 `octobuddy-cli 0.1.13`，本次未出现先前的 CLI artifact missing 错误；这是本地预览启动验证，不是安装包发布认证。Client 全量类型检查和独立预览构建通过。
- 最终 `mock-final` 制品整跑 21 项 Electron 用例：20 项通过，既有无响应恢复用例在初次等待 ready 时遇到导航销毁上下文，单独复跑通过。6 项新增浮层和 3 项既有原生外壳用例均在整跑中通过；没有修改既有恢复测试或将重跑包装为一次全绿。
- 子区额外检查 1440x900、1120x760、900x700：标题和操作按钮保持在视口内且避让宿主窗口控件，关闭后在相同窗口尺寸下恢复原输入框布局。900 宽截图仍显示既有三栏布局挤压会话区，输入操作排列不理想；本轮未修改业务分栏策略，不将按钮避让通过等同于窄窗排版合格。
- 拖动守卫文件的独立 TypeScript 检查通过（ES2022、DOM、DOM.Iterable）；Web 全仓类型检查的历史缺口仍保留，不将局部检查代替全仓结果。

### 最新同步与制品联调（2026 年 9 月 11 日）

- 当前 Web 分支已基于 `upstream/main` 的 `3e9a5ae629b62c7ec6cd2444db0136c04bebd5f5`，保留本地桌面适配改动，无推送或主工作目录修改。
- Client 同步到 `origin/main` 的 `9fe9adc`，采用最新嵌入模块宿主接线和组织状态修复，移除本地重复接线；保留桌面原生展示、菜单及路由同步保护。
- 重新构建通信、总结、应用三个独立制品，均为 `1.0.12` / `3e9a5ae6`，契约修订分别为 3、2、1。另从 Docs `8fccc33b` 构建 Docs `1.0.0` / 契约修订 3，使用此 Web worktree 作为 base 依赖，清单中记录完整源码身份。
- 四份真实预览产物均明确标记 `sourceDirty: true`、`e2eMock: false`、API/IM mock flags 为 `"0"`，没有 Mock Service Worker。Client 精确锁定四份清单及 Docs 的 `sources.base`，没有放宽发布校验。mock 回归产物与真实预览目录分开，不将 dirty 制品当作发布输入。
- Web 适配器/CommunicationShell/readyReporter 的 33 项测试、普通浏览器构建通过。普通浏览器全部 6 个 JS/CSS 产物均未发现 `getDesktopPresentation`、`data-desktop-integrated` 或 `--desktop-chrome-background`，共享页头的无行为属性不影响这一隔离边界。
- 最新 Client 全量类型检查和构建、172 项定向组件测试、102 项制品/IPC/几何/菜单测试、34 项预览工具测试、31 项 Electron E2E 通过。总结和应用制品现已齐备，无需再排除相关集成流程。
- 真实 Docs 产物在原生/普通外壳下的 fixture E2E 各 1 项通过：正文、草稿保护、菜单遮挡、只读隔离、视图生命周期与四个窗口尺寸均有检查。它使用测试后端，不代表生产数据写入验收。
- Web 全量类型检查、Windows 原生桌面交互、安装包/签名发布、真实服务完整业务仍未验证通过。Client 较早的全量组件运行有 2 项任务列表基线失败，不将定向通过写成全量通过。

真实预览在 Client worktree 使用 `pnpm run preview:features`，传入本 Web worktree 的 `OCTOBUDDY_WEB_ROOT`、Docs worktree 的 `OCTOBUDDY_DOCS_ROOT` 及 `OCTOBUDDY_NATIVE_DESKTOP=1`。完整命令和独立数据目录见 Client 方案的“启动真实制品预览”。macOS 使用独立 `OctoBuddy Live Preview.app`，不覆盖正式客户端；需手动登录生产 API，写操作会影响真实数据。

最新真实预览已修复启动脚本的无障碍 API 就绪时序，日志确认窗口 `ready-to-show`，临时运行时签名校验通过。检查时 Mac 锁屏，最新窗口的整窗目测及登录后验证尚未完成，不能用自动化 fixture 结果替代。

以下第二轮和第一轮记录为历史；代码基线、制品与验证状态以上方最新记录为准。

### 第二轮范围（历史，2026 年 9 月 11 日）

- 保留第一轮修改后将工作分支 rebase 到 `upstream/main` 的 `9c14b738`，不推送、不动主仓库。
- 已有 Chat、ConversationWindow、NavHeader、WKViewQueueHeader、RoutePage 页头增加显式 `data-desktop-chrome="header"` 声明；不移动 DOM、不复制业务状态或回调。桌面适配器不再根据外观类名猜测页头，仍保留必要的矩形观察与动画追踪。
- 展示协议增加可选的 `appearance` 三色字段；仅验证并消费宿主传入的顶栏背景、前景与分隔线。旧 payload 没有该字段时继续使用本地主题回退。
- 明确区分协商成功与当前视图真正顶到窗口顶部。仅融合时才把分栏拖动区/竖线移到顶栏下方，空会话区顶部补与宿主一致的背景。
- Client 的原生账号/组织菜单不再隐藏消息，打开文档预览不再插入独立标题栏。原 Web 的搜索、群设置、弹层仍在消息 `WebContentsView` 内运行。
- Client 同时修复 HashRouter 与 view 状态之间的旧路由回写竞争，避免内部切换到消息后又收到旧通讯录导航；修复仅在 Client，Web 的 `CommunicationShell` 和消息业务逻辑没有因此修改。
- 普通浏览器入口和旧 Electron 入口不加载桌面适配器及 CSS；共享组件仅有无行为的展示属性声明。后续构建检查应检查桌面样式/协议没有泄漏，不能再以“所有 data-desktop 字符串均为零”作为标准。
- 本轮不包含业务页头原生重写、跨渲染进程 Portal、毛玻璃、全局主题迁移或消息功能重构。

### 第二轮验证结果（历史）

- 适配器、CommunicationShell、readyReporter：33 项通过；既有会话页头、聊天状态、线程/右面板及分栏测试另有 26 项通过。
- 普通浏览器产物和通信 fixture 均构建成功。普通 Web 输出中只有共享页头的无行为标记，没有桌面适配器、协议入口或专用样式；未修改普通浏览器启动路径和消息业务回调。
- Client 主进程类型检查、完整构建通过，107 项相关单测及 81 项定向组件测试通过。
- Electron 15 项定向回归通过，覆盖既有 hash 路由、通信业务、菜单、预览、缩放、草稿、焦点及默认关闭回退。新增通讯录连续三次进入群聊、实际检查输入框的用例。
- 较早的 macOS 真窗口已检查消息页头/红绿灯融合及原生账号菜单；最新独立预览已观察通讯录、群资料弹层、进入群聊和融合页头。之前空白的遮挡因素已确认，见下节。Windows 只有实现与配置/几何测试，没有 Windows 真机结论。
- 曾观察到通讯录切换后会话空白，已在 Client 复现并修复旧路由回写新 view 的竞争，4 项同步单测及路由/通信 E2E 通过。仍需真实服务及跨平台验证。总结跳转用例因缺少总结制品未通过，最终定向运行排除了这一项。
- 文档预览测试覆盖外壳及错误回退，不代表真实文档内容联调。Web 全量类型检查与 Client 基线类型/任务列表问题仍未解决。

### 独立窗口复查

先前 Client 报告消息已挂载，但页面为 `hidden`、截图为空白。解锁后检查系统窗口层级，发现预览被其他前台应用遮挡，宿主页面也会停绘；实际置前后消息恢复显示，不需修改 Web 业务或重建消息视图。最新真窗口观察包含通讯录展开群聊、群资料弹层、进入群聊及融合后的消息页头。

Client 的开发预览现在使用独立的临时 macOS 应用身份、首次启动置前和应用自身的无障碍树；临时运行时副本通过签名验证，另有 4 项链接结构测试。正式应用、原依赖目录及 Web 入口不受这些预览工具改动影响。没有把置顶或禁用后台节流写进产品逻辑。

Playwright Electron 启动器自带禁用后台节流/遮挡优化的开关，因此 DOM/布局测试仍不能替代普通启动参数下、真实前台可见时的整窗验收。最新人工检查不增加输入/发送或完整菜单回归声明；Windows、锁屏恢复、长时间运行及发布安装包仍待专项验收。详细范围见配套 Client 文档。

以下为第一轮历史记录；与第二轮有差异时以上方记录为准。

- Web 基线更新到 `upstream/main` 的 `1b438e7a`；Client 基线更新到 `origin/main` 的 `c1c44ea`。仍在两个独立 `analysis/native-desktop-presentation` worktree 中工作，没有改动已安装应用。
- 新增 `apps/web/src/client-communication/desktopPresentation.ts`、`desktop-presentation.css` 和适配器测试；只在 `hostBridge.ts` 与该独立入口 `index.tsx` 接入。
- 实际协议为 `DesktopPresentation` 版本 1：包含平台、修订号、能否融合、顶部高度/区域、控件排除矩形以及窗口焦点/最大化/全屏状态。尚未包含后续路线图中的材质和辅助功能协议。
- 只有可信宿主提供完整可选能力且协商成功才激活局部样式。协商超时 1 秒、接口异常、能力缺失均继续原消息启动流程，不上报桌面能力。
- 适配现有列表、会话、导航、队列和实际 `RoutePage` 页头；聊天详情使用 `.wk-route-header`，不是历史 CSS 中的 `.wk-channelsetting-header`。隐藏/inert、移出顶部或横向移出的页头不占用原生顶部。
- 用 DOM 几何观察计算局部左右避让，不替换 React 子树，不复制业务动作。平台字体、页头高度、按钮间距和失焦样式只挂在协商后的独立根节点下。
- 第一轮高度由 Client 提供（52 DIP 换算成接收端 CSS 像素），未知 Windows WCO 几何由宿主保留安全顶栏。通讯录、预览和 Apps 组合页暂不融合。
- 普通 `apps/web/src/index.tsx`、共享消息/导航业务代码、旧独立 Electron 26 构建入口均未修改。新样式没有进入普通 Web 构建输出。

### 第一轮验证记录（历史）

- 适配器、CommunicationShell、readyReporter：29 项通过，包含双侧排除区、协议校验、旧宿主/关闭状态、协商超时/异常、过期修订、隐藏路由、滑入动画逐帧几何及订阅清理。
- 原会话页头、Chat 状态、线程页头、右面板和分栏：26 项通过。
- 普通 Web 和通信 fixture 制品构建通过；普通 Web 产物扫描没有新增的桌面标记和能力引用。
- Client 单测 75 项、定向组件测试 68 项通过；开启外壳的 8 项现有 Electron 通信回归通过，包括发送/附件和恢复流程。
- 新增 2 项 Electron 外壳测试通过：融合、独立缩放、详情关闭焦点、通讯录回退和草稿保留，以及默认关闭的原布局。
- macOS 已看真窗口，检查系统红绿灯和融合页头；绿色按钮放大/还原通过。窗口拖动、双击偏好仍需人工确认。
- 本轮不宣称浏览器全量回归通过。Web 全量 typecheck 仍被已有 React 类型/模块解析问题阻断；Client 全量渲染器 typecheck 和两项任务列表组件测试也有已识别的基线失败。
- 末轮 Mac 锁屏阻断了最新隔离预览的整窗截图，待解锁补验；不能将内嵌页面的 Playwright 截图当作含原生窗框的截图。

### 预览与发布边界

Client 目录下运行 `pnpm run preview:native`，使用新临时配置目录和 API/IM fixture，不触碰正式账号数据。具体重建命令见配套 Client 文档“实施记录”。

早期本地通信清单是 `1.0.12` / `3e9a5ae6` / 契约修订 3，最新隔离预览已更新为 `6989cae1` 基线。真实预览产物标记 dirty + non-mock；回归 fixture 另行构建并标记 dirty + mock，Client 精确校验未取消。源码可以先独立提交；正式发布须生成非 mock、已提交源码对应的制品，再同步 Client 锁定身份。

Windows 的 WCO/Snap/系统菜单/混合 DPI、900 以下窄窗、深色/高对比度、材质、完整业务与安装包验收仍未完成。此轮只交付可关闭的外壳实验；不把不透明 React 页头称为 AppKit/WinUI 原生工具栏。

## 一、推荐结论

**macOS 与 Windows 都是首版交付平台。先做“平台窗口控件 + 融合式 Web 页头”，再按需增强业务工具栏。**

第一阶段在 macOS 保留系统红绿灯，在 Windows 使用 Electron 的 Window Controls Overlay（WCO，窗口控件叠加层）提供窗口按钮；两端各自遵循系统的窗口交互。现有 React 业务页头与窗口顶部融为一层，不再在业务页头上方额外增加一条工具栏。

两端共用业务逻辑、展示协议和行为测试，但不强求控件位置、字体、材质和快捷键完全相同。目标是在各自系统里自然，而不是把 Windows 做成 macOS 的换色版本。

AppKit `NSToolbar` 仅是 macOS 可选增强，不是公共架构或 Windows 的前置依赖。Windows 第一版使用 WCO 与符合 Windows 习惯的 React 业务工具栏；这不等于嵌入 WinUI 3。只有在某个操作的业务行为和状态形成可复用接口后，才考虑各平台的进一步原生化。

不能因为某个 React 扩展没有原生实现，就删除它。本轮也不使用 AppKit 或 WinUI 重写消息业务。

## 二、调研基线

| 仓库 | 独立工作目录 | 调研开始时的基线 |
| --- | --- | --- |
| Web | `octo-web-native-desktop` | 最初 `a29b1fec`；实施前同步到 `1b438e7a` |
| Client | `octo-buddy-client-native-desktop` | 最初 `3162e13`；实施前同步到 `c1c44ea` |

两个分支均为 `analysis/native-desktop-presentation`。原有工作目录和之前的 `octo-buddy-client-window-chrome` 原型没有修改。最初调研仅有文档；当前已经实施但未提交代码。

调研基线中的 Client 锁定通信制品 `1.0.12`、提交 `83a9f9bc`、桥接协议主版本 1、契约修订版本 3。后面的文件地图描述的是这两个调研分支的源码，不代表这些源码已经全部进入已安装的应用。

Client 锁定的 Electron 版本是 `40.10.6`；Web 仓库中旧独立桌面应用的 Electron 版本是 `26.0.0`。两者不是同一个桌面运行环境，不能混为一谈。

## 三、源码中的关键发现

1. `apps/web/src/client-communication/index.tsx` 和 `vite.client-communication.config.ts` 已经构成独立的内嵌入口与构建产物。普通浏览器入口是 `apps/web/src/index.tsx`，可以利用这个边界隔离桌面改造。
2. `CommunicationShell.tsx` 使用 `WKLayout embedded`，不再显示 Web 自己的主导航栏，因为 Client 已提供导航。现有 `workspace` 和 `conversation` 分别控制内容布局；桌面外观应该是独立设置，而不是增加第三个互斥的布局值。
3. `Components/ConversationWindow/index.tsx` 已经把页头模型、多选模型与会话内容分开。但页头中的值是 React 节点，不是可以直接传给原生端的序列化描述。
4. `Pages/Chat/index.tsx` 负责线程面包屑、返回导航、线程面板、频道设置与焦点恢复、多选，以及搜索面板之间的协调。简单隐藏页头会移除真实功能。
5. `EndpointCommon.tsx` 允许注册任意 React 频道页头组件。搜索入口来自 `dmworkbase`；星形入口来自 `dmworksummary`，表示智能总结，不是收藏开关。
6. `ChatSummaryStarButton.tsx` 会异步查询总结，并决定打开历史还是新建。取消请求与真实失败有不同处理。原生按钮如果只发送一个通用“切换”事件，行为并不等价。
7. `WKLayout` 自己管理 DOM 列宽和拖动。拖动期间直接写 CSS，结束时才提交 React 状态。如果原生分隔线只监听 React 状态，拖动过程中就会跟不上内容。
8. `WKViewQueue` 会保留底层路由组件的挂载状态。当前窗口标题不能由“最后一次上报的组件”决定，必须明确当前活动页面。
9. Client 的启动数据提供器目前固定传入浅色主题和中文语言。系统窗口与内嵌页面尚未共用一个外观状态来源。
10. 通信模块是真正的 `WebContentsView`，不是 iframe，也不是宿主 React 树中的普通子组件。React Portal 可以调整同一页面内的渲染位置，但不能直接把内容搬进宿主页面或 AppKit 工具栏。
11. Client 的 `electron/main/app-window.ts` 将窗口最小宽度设为 900。只增加 Windows 贴靠菜单并不够，部分贴靠区域会容纳不下窗口；必须先验证桌面专用的窄窗布局，再调整这个限制。

## 四、方案对比

| 方案 | 原生质感 | 对现有功能的影响范围 | 建议 |
| --- | --- | --- | --- |
| A. 只统一现有标题条的颜色 | 改善有限，多余的顶部横条仍然存在 | 较小 | 仅适合临时修整 |
| B. 平台窗口控件与现有 Web 页头融合 | 两端视觉融合程度高，业务按钮仍是 React | 主要涉及布局、输入和外观边界 | macOS、Windows 同期实现 |
| C. 平台工具栏适配 + Web 业务动作接口 | macOS 可用 AppKit；Windows 使用独立适配方案，不假设 Electron 已提供 WinUI 工具栏 | 涉及动作抽取、异步状态、焦点、扩展和几何同步 | B 稳定后按平台增强 |
| D. 原生会话列表和工具栏，只保留 Web 消息内容 | 原生化上限最高 | 需要重新实现未读、选择、列表导航等业务 | 不纳入本轮 |

方案 B 不在渲染进程中手画红绿灯或最小化/最大化/关闭按钮。macOS 保留系统控件，Windows 由 Electron 原生层的 WCO 管理窗口控件；其中的 React 业务按钮不能被称为 `NSToolbarItem` 或 WinUI 原生控件。

## 五、预期视觉结构

顶部只有一层共享区域，下方才是各列内容：

| 区域 | macOS | Windows |
| --- | --- | --- |
| 顶部左侧 | 系统红绿灯，组织与列表操作避让控件 | 组织与列表操作，不预留假红绿灯空位 |
| 顶部会话区域 | 当前会话面包屑、会话操作 | 当前会话面包屑、会话操作，右侧避让窗口按钮 |
| 顶部最右侧 | 按 macOS 布局使用 | WCO 最小化、最大化/还原、关闭按钮 |
| 内容区域 | 应用导航、会话列表、消息正文、按需展开的侧面板 | 保持相同业务结构，间距和字体按 Windows 适配 |

- 去掉独立且空白的标题条，不删除有用的业务页头。
- 现有页头仍处于各自 Web 列的顶部，只统一高度。调整列表宽度时，标题和内容自然保持对齐。
- 安全区按宿主上报的真实几何计算。macOS 主要避让左侧红绿灯；Windows 主要避让右侧窗口按钮。协议同时支持两侧占用，不把方向和宽度写死。
- macOS 的狭窄导航栏不一定容纳得下整个红绿灯组；Windows 的聊天搜索、更多按钮也不能挤进最大化按钮区域。列表和会话标题分别处理与安全区的交集。
- 顶部高度按平台控件尺度和实际几何协调，不跨平台共享一个固定高度。macOS 可先试验 48 至 56 个逻辑像素；Windows 以 WCO 尺寸与业务控件的实际需求为准。
- macOS 导航与列表可使用连续的侧栏材质；Windows 可在窗口基底和顶部使用 Mica，内容层保持清晰。消息正文与输入框保持不透明，优先保障阅读。
- 桌面字体使用平台回退链：macOS 使用系统字体；Windows 可优先 `Segoe UI Variable`、`Segoe UI`，再回退到 `system-ui`，并验证中文回退。通过桌面局部设计变量调整，不全局改变消息排版。
- 两端分别校准分隔线、焦点、悬停、禁用和失焦状态。业务图标继续复用现有图标库，不把 SF Symbols 作为 Windows 的依赖。
- “关注/最近”仍留在列表内。总结、搜索、线程面板、输入框、消息和附件操作继续由原来的模块负责。
- 窗口标题元数据应描述当前内容，但不必再额外显示一份重复标题。

### Windows 材质与窄窗策略

Windows 11 支持的构建上，可通过 Client 锁定的 Electron 40.10.6 的 `setBackgroundMaterial('mica')` 增强窗口基底；该 Electron API 的支持边界是 Windows 11 22H2 及以上，不能套用其他 Windows SDK 的版本边界。

不支持该能力的 Windows 版本、关闭透明效果或高对比度场景，使用不透明的系统主题背景。若产品继续发行 Windows 10 版本，也保持相同融合布局和业务能力，仅降级材质。不为此改变产品已有的操作系统支持政策。Mica 是窗口基底材质，不是给每个按钮加毛玻璃，更不是必须启用的视觉前提。

针对贴靠后的窄窗口，桌面模式应折叠主导航或会话列表，保留返回列表的入口、当前草稿与滚动状态。首先验证 760 和 500 DIP 附近的可用布局，再决定窗口最小宽度；微软建议最小宽度不大于 500 个有效像素，以适配常见贴靠区域。不能只把 `minWidth` 从 900 调小而不适配内容，也不能改动普通 Web 的默认断点。

### 首版平台承诺

| 平台或场景 | 首版要求 |
| --- | --- |
| macOS | 融合页头、原生红绿灯、拖动与全屏、系统外观协调 |
| Windows 11 | 融合页头、WCO、最大化/还原、系统菜单与贴靠、DPI/多屏适配 |
| Windows 材质不可用或辅助功能启用 | 保留同一功能和布局，材质与颜色按系统要求回退 |
| 普通 Web、旧独立桌面入口 | 不启用新展示能力时，默认行为保持不变 |
| Linux | 本轮不扩张支持范围，保留现有功能和窗口框架 |

## 六、兼容边界

只在通信内嵌入口增加可选、带版本的桌面展示能力协商。下面的接口名称只是设计草案，不是已经存在的 API：

```ts
type DesktopPresentationMode = "unified-web-v1" | "native-toolbar-v1";

interface DesktopPresentationOffer {
  version: 1;
  platform: "darwin" | "win32" | "linux";
  modes: DesktopPresentationMode[];
}

interface DesktopRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DesktopPresentationGeometry {
  revision: number;
  effectiveTheme: "light" | "dark";
  focused: boolean;
  maximized: boolean;
  fullscreen: boolean;
  headerHeight: number;
  headerContentRect: DesktopRect;
  windowControlsExclusionRects: DesktopRect[];
  highContrast: boolean;
  reducedTransparency: boolean;
  material: "opaque" | "system-backdrop";
}
```

`DesktopPresentationOffer` 表示可信宿主提供的平台与展示能力；`DesktopPresentationGeometry` 表示有效主题、窗口状态、可用顶部区域、窗口按钮避让区域和辅助功能状态。共享协议不暴露 `NSView`、`HWND`、SF Symbols 或 WinUI 类型，材质的具体实现留给平台适配层。

- 只有可信宿主桥接、且双方接受能力协商后，才能启用桌面样式。不能根据 user-agent、`isElectron`、URL 参数或全局 `__POWERED_ELECTRON__` 标记自行启用。普通浏览器和旧独立桌面入口保持原路径。
- 没有桌面能力提供器时，使用现有 Web 渲染与事件处理。普通浏览器入口不得引入桌面 CSS 的副作用。
- `workspace` / `conversation` 与桌面展示模式相互独立。
- 坐标必须有明确契约：Client 将窗口内容区的设备无关像素（DIP）转换为子视图的 CSS 坐标，包含视图原点和页面缩放。不能认为只处理 `devicePixelRatio` 就完成了转换。
- Windows WCO 提供的顶部几何由宿主可靠地采集、校验并转换后下发。不能假设独立 `WebContentsView` 会自动继承主窗口的 `env(titlebar-area-*)` 或得到相同坐标。
- 页面缩放和操作系统 DPI 缩放分别处理；跨屏、最大化/还原、贴靠、全屏和视图布局变化都要更新几何版本。
- 协商失败时不隐藏业务页头，Client 保留可用的系统控件与安全区；必要时在下次建窗恢复标准边框。不把运行时改写 `titleBarStyle` 当成既有公开能力。切换页面时避免出现两套竞争的顶部布局。
- 协议只传展示信息，不向渲染进程开放原生指针、文件访问或通用原生方法调用。
- 两端快捷键复用同一语义动作，修饰键按平台展示与执行。保留系统的 `Alt+Space`、`Alt+F4`、`Win+Z` 等行为，不在 Web 全局监听中拦截系统键。

方案 B 不需要导出业务动作。优先保留原有页头组件树和回调；除非有明确的布局约束，否则不要移动或重新挂载组件。

## 七、必须保持的行为清单

下表是需要验证的不变条件，不代表布局改造没有风险。

| 行为 | 继续负责的模块 |
| --- | --- |
| 全局搜索、搜索结果跳转 | 现有 Chat 页面和搜索模块 |
| 当前会话内搜索、功能开关判断 | 现有频道搜索模块 |
| 总结查询、历史/新建分流、失败和取消处理 | 总结模块 |
| 线程面包屑、返回父级、线程列表开关 | Chat 页面 |
| 频道设置、关闭行为、焦点恢复 | Chat 页面和设置面板 |
| 多选数量、取消、转发和删除流程 | 现有会话选择逻辑 |
| 添加菜单、创建分组/群聊、权限判断 | 现有列表页面及业务模块 |
| 关注/最近、未读跳转、列表拖动、宽度保存 | 现有列表与布局逻辑 |
| 草稿、输入法、发送、语音、附件、未发送附件确认 | 现有输入框和会话模块 |
| 搜索/文件/文档预览、返回导航 | 现有预览集成 |
| 应用机器人会话的专用页头 | 应用机器人模块 |
| 通讯录、保留的左右导航栈 | 现有路由逻辑 |
| 组织切换、退出登录、重载、未读更新 | 现有宿主与模块生命周期 |
| 尚未识别的企业版页头扩展 | 现有扩展渲染器 |

## 八、第一版文件地图

以下路径相对于 Web 工作目录。

| 文件 | 计划职责 |
| --- | --- |
| `apps/web/src/client-communication/hostBridge.ts` | 可选的桌面展示类型与能力协商 |
| `apps/web/src/client-communication/index.tsx` | 仅为这个独立入口安装适配器 |
| `apps/web/src/client-communication/CommunicationShell.tsx` | 应用协商后的模式、几何和外观，保留业务上下文提供器 |
| `apps/web/src/client-communication/desktopPresentation/`（新增） | 两端共用的展示适配、几何解析、生命周期和测试，不依赖原生工具包 |
| `apps/web/src/client-communication/desktopPresentation/index.css`（新增） | 共用结构，以及宿主显式选择的 macOS/Windows 局部样式、两侧安全区和辅助功能状态 |
| `packages/dmworkbase/src/Components/ConversationWindow/` | 仅在局部样式不足时增加可选的展示接口或设计变量，默认行为不变 |
| `packages/dmworkbase/src/Components/WKLayout/` | 必要时增加可选几何上报及桌面窄窗接口，浏览器默认断点和分栏算法不变 |
| `apps/web/vite.client-communication.config.ts` 及构建脚本 | 保持独立内嵌产物与制品清单兼容 |

新的适配逻辑落在独立入口中，不继续堆进通用的 `Pages/Chat` 类。如果共享组件确实需要增加可选展示属性，先补齐基线测试和“不提供桌面能力”的测试，再启用。

## 九、方案 C：进一步升级原生工具栏

只有方案 B 稳定后，再考虑以下工作：

这一阶段按平台选择呈现方式，不把 `NSToolbar` 当成跨平台 API。macOS 可以接 AppKit；Windows 第一版保留经过平台样式适配的 React 业务工具栏。以后确有需要再单独评估 Windows 原生控件集成的成本，不把它描述成现成的 WinUI 支持，也不因此推迟 Windows 首版。

1. 定义语义化动作模型，包括稳定 ID、标签、图标标识、可见性、可用/选中/忙碌状态，以及 Web 侧执行函数。保留原有浏览器入口与展示组件。
2. 将每个已支持动作的行为抽成一份共享控制器或 Hook。React 与原生展示使用相同的业务行为，包括总结查询、错误处理、埋点、功能开关与权限判断。
3. 只向 Client 发送可序列化的展示状态。macOS 适配层可将图标标识映射为 SF Symbols；Windows 使用其适配层支持的控件与图标表达。不能序列化 React 节点，也不能通过模拟点击隐藏 DOM 来执行动作。
4. 动作执行必须绑定当前活动视图代次、路由、频道与展示修订号。后台保留的路由不能覆盖当前工具栏；过期动作不能误作用于刚切换的新会话。
5. 保留右侧辅助会话自己的页头，不能把所有 `ConversationWindow`，包括线程预览，都上报到主窗口工具栏。
6. 多选或模态界面接管交互时，禁用或正确替换相应命令。关闭后将焦点恢复到正确的原生触发按钮或 Web 控件。
7. 对完整的可见页头进行能力协商，而不是只支持写死的一小组按钮。遇到尚未适配的 React 扩展，该页面回退到方案 B，不能让它在“更多”菜单改造中悄悄消失。
8. 明确弹层锚点归属：Web 弹层无法超出自身视图矩形去覆盖原生工具栏。能够完整表达的菜单使用原生菜单，否则保留 Web 顶部中的原触发器与弹层。

AppKit 的 `NSTrackingSeparatorToolbarItem` 需要真正的 `NSSplitView`，现有 `WKLayout` 的 DOM 分栏不满足这个条件。因此，原生工具栏需要显式同步几何，或者在后续重新设计原生容器。不要为了绑定分隔线而增加一个隐藏的假原生分栏。

## 十、PR 拆分

1. **跨平台展示契约与安全测试：** 增加可选能力、双侧安全区和窗口状态，保持浏览器默认渲染不变，同时覆盖 macOS/Windows 回退路径。
2. **双平台融合式通信外壳：** 同期交付 macOS 控件、Windows WCO、各平台样式和窄窗布局。可分开开发 PR，但两端都通过首版验收才算本阶段完成。
3. **双平台材质与外观打磨：** macOS 侧栏材质、Windows Mica/不透明回退，以及宿主/子视图浅深色、失焦、减少透明度与高对比度的一致处理。
4. **可选原生工具栏动作：** 基线等价测试通过后，每次只接入一组边界明确、共享业务行为的动作。

不要把消息引擎抽取、API 迁移、模块路由重写或 Electron 大版本升级混进这些改动。

## 十一、验证计划

### 浏览器与旧桌面入口

- 不提供桌面能力时，普通页头 DOM、操作、路由、主题、视口适配和扩展注册必须保持基线行为。
- 分别构建普通 Web 与内嵌通信模块，检查桌面专用 CSS 和原生桥接引用没有进入浏览器入口。
- 旧独立 Electron 26 应用继续使用默认路径。
- 复用并扩展 `ConversationWindow.test.tsx`、`ChatPage.state.test.tsx`、`threadHeaderLayout.test.ts`、`rightPanelState.test.ts`、`WKLayout.drag.test.tsx` 和 `CommunicationShell.test.tsx`。
- 使用现有总结测试和新增适配器等价测试，覆盖历史/新建查询成功、错误、取消和频道切换。
- 在普通 Web 与协商成功的桌面模式中，分别回归前面的行为清单。

### 真实 Client 窗口

- 两个平台分别检查 1440x900、1120x760、900x700，并覆盖打开文档或其他侧栏后内嵌内容变窄的情况。当前原生最小宽度为 900，760x800 和约 500 DIP 的窄窗先做布局验证；实现可用的折叠策略并调整最小宽度后，再验收真实窗口，不能把强制设置截图尺寸当成已支持。
- macOS 验证红绿灯、拖动/不可拖动区域、系统双击偏好、全屏切换、失焦和不同缩放显示器。
- Windows 验证最小化、最大化/还原、关闭、边缘缩放、标题区域双击、右键系统菜单、`Alt+Space`、`Alt+F4`、任务栏恢复和多显示器移动。
- Windows 11 实测最大化按钮悬停的 Snap Layouts、`Win+Z`、拖到边缘贴靠及贴靠后恢复。窗口尺寸约束、顶部命中区域和子视图覆盖都必须正确。
- Windows 分别验证 100%、125%、150%、200% 系统缩放，以及不同 DPI 显示器之间移动。页面缩放另测，检查按钮、文字、安全区、弹层和拖动区域没有漂移。
- Windows 验证高对比度/强制颜色、关闭透明效果、浅深色和失焦状态。材质不可用时仍能分辨文字、边界、选中、悬停和禁用状态。
- 检查输入焦点、中文输入法、快捷键、多选和弹层定位。
- 分别打开宿主与子视图的菜单、模态界面，确认不会被其他原生视图遮挡而失去交互，原生命令也必须遵守模态状态。
- 页头和布局变化期间，保留草稿、滚动位置和即时通信状态。
- 覆盖不支持能力、旧制品、重载、崩溃、隐藏视图、切换组织、退出登录，以及延迟到达的 IPC。
- 两端窗口边框和控件必须使用真实原生窗口截图及交互验证。只在 macOS 上截图、模拟 Windows user-agent 或运行浏览器测试，不能证明 Windows 原生体验正确。

### 打包发布

Client 会精确校验制品清单，包括契约修订版本。新增可选能力并不能绕过制品兼容检查。

构建并发布新版本通信制品时，同步更新 Client 锁定版本；保留前一版制品和能力关闭路径用于回退。不能为了加载本地预览而放宽发布环境的清单校验。

同一个 Web 通信制品应通过能力协商服务两个平台。macOS 与 Windows 各自完成安装包启动和窗口交互验收；后续增加 AppKit 扩展时，Windows 构建与加载路径不得要求它存在。Windows 不因缺少 Mica 而无法启动。

## 十二、尚未完成的验证

当前已运行上方“实施记录”中的构建、测试和 macOS 预览。Windows 的 WCO/Snap、系统菜单、多显示器 DPI 和两端完整系统交互仍需实机验收；900 最小窗口宽度限制尚未解决。

源码或 API 中存在相关能力，不等于通过真实窗口验收。完整行为清单、非通信模块、真实服务与发布安装包仍须按阶段补验，不能把 fixture 测试等同于产品无回归。

## 十三、官方参考

- [Electron 自定义标题栏](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar)
- [Electron 40.10.6 的 BaseWindow API](https://github.com/electron/electron/blob/v40.10.6/docs/api/base-window.md)：`setTitleBarOverlay` 与 `setBackgroundMaterial`，后者要求 Windows 11 22H2 及以上。
- [Electron 40.10.6 的 WebContentsView 实现](https://github.com/electron/electron/blob/v40.10.6/shell/browser/api/electron_api_web_contents_view.cc)：涉及拖动区域归属、坐标转换和视图背景色传递。
- [微软：桌面应用支持 Snap Layouts](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/apply-snap-layout-menu)：最大化按钮命中、Electron 支持和最小窗口宽度建议。
- [微软：Mica 材质](https://learn.microsoft.com/en-us/windows/apps/design/style/mica)：窗口基底用途、内容分层及高对比度/关闭透明效果等回退场景。
- [AppKit 跟踪式工具栏分隔线](https://developer.apple.com/documentation/appkit/nstrackingseparatortoolbaritem)：要求同一窗口中的 `NSSplitView`。
- [AppKit NSGlassEffectView](https://developer.apple.com/documentation/appkit/nsglasseffectview)：适用于 macOS 26 及以上。

调研时在线 Electron 教程示例使用的版本比 Client 更新，实施时仍须以 Client 锁定版本为准。CSS 模糊、Electron vibrancy 和 `NSGlassEffectView` 不是同一项能力。
