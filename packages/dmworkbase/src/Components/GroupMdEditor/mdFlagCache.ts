/**
 * GROUP.md / Thread.md「已配置」状态写回 channelInfo.orgData 的字段映射（纯函数）。
 *
 * 设置面板副标题读 orgData.has_group_md / has_thread_md（根层）+ 对应 *_md_version，
 * 渲染「已配置 v{n}」或「未配置」。保存/删除 md 后，需按 channelType 把这两个标志位写回：
 *   - 群频道：has_group_md / group_md_version（均在 orgData 根层）。
 *   - 子区频道：has_thread_md / thread_md_version；注意子区在 orgData 根层与嵌套的
 *     thread 对象里各存一份（见 datasource.ts toThread 与 channelInfo.ts 子区分支），
 *     两处必须同步，否则缓存内部自相矛盾。
 *
 * configured / version 由调用方用后端返回的权威 version 派生（version > 0 即已配置），
 * 不是前端假设——与副标题「已配置 v{version}」及编辑器 version>0 显示版本标签的判断自洽。
 *
 * 返回新的 orgData（不 mutate 入参）。字段映射是本次改动最主要的出错面，
 * 独立成纯函数以便单测精确覆盖 thread/group、根层/嵌套、保存/删除各分支。
 */
export function withMdFlags(
  orgData: Record<string, unknown>,
  isThread: boolean,
  configured: boolean,
  version: number
): Record<string, unknown> {
  if (!isThread) {
    return { ...orgData, has_group_md: configured, group_md_version: version };
  }

  const next: Record<string, unknown> = {
    ...orgData,
    has_thread_md: configured,
    thread_md_version: version,
  };

  // 嵌套 thread 对象若存在，同步其标志位（副标题只读根层，但保持缓存一致）。
  const thread = next.thread as Record<string, unknown> | undefined;
  if (thread) {
    next.thread = {
      ...thread,
      has_thread_md: configured,
      thread_md_version: version,
    };
  }

  return next;
}
