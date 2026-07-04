import { EndpointCategory, EndpointID } from "./Const";
import { EndpointManager } from "./Module";


export default class MenusManager {
  private constructor() {
  }
  setRefresh?:()=>void
  public static shared = new MenusManager()
  // 工厂可返回 undefined 表示「当前不展示该菜单」——invokes() 用 `if (result)` 过滤 falsy，
  // 配合 refresh() 可实现按 remoteConfig(如 docsOn)运行时显隐,无需 unregister。
  register(sid: string, f: (param:any) => Menus | undefined,sort?:number) {
    EndpointManager.shared.setMethod(
      `${EndpointID.menusPrefix}${sid}`, (param) => f(param),
      { category: EndpointCategory.menus,sort:sort });
  }
   menusList(): Menus[] {
    return EndpointManager.shared.invokes<Menus>(EndpointCategory.menus, {});
  }

  refresh() {
    if(this.setRefresh) {
      this.setRefresh()
    }
  }
}


export class Menus {
  id!: string;
  title!: string;
  icon!: JSX.Element;
  selectedIcon!: JSX.Element
  routePath!: string;
  onPress?: () => void;
  badge?: number

  constructor(id: string, routePath: string, title: string, icon: JSX.Element, selectedIcon: JSX.Element, onPress?: () => void) {
    this.id = id
    this.title = title
    this.icon = icon
    this.selectedIcon = selectedIcon
    this.routePath = routePath
    this.onPress = onPress
  }
}
