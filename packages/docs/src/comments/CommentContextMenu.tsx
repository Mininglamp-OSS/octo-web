// 兼容层:实现已挪到 ../ui/ContextMenu.tsx(它跟评论没有耦合,版本记录也在用)。
// 这里只做转发,免得动到既有 import 和测试。
export {
  ContextMenu as CommentContextMenu,
  useContextMenu as useCommentMenu,
  type ContextMenuItem as CommentMenuItem,
  type MenuAnchor,
} from '../ui/ContextMenu.tsx'
