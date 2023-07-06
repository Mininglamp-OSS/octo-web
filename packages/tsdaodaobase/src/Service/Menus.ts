import { EndpointCategory, EndpointID } from "./Const";
import { EndpointManager } from "./Module";


export default class MenusManager {
  private constructor() {
  }
  setRefresh?:()=>void
  public static shared = new MenusManager()
  register(sid: string, f: (param:any) => Menus,sort?:number) {
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
