// Typecheck-only boundary for the source-direct @octo/base package. Runtime and
// Vite builds continue to resolve the real host package.
declare module "@octo/base" {
  export interface IModule {
    id(): string;
    init(): void;
  }

  export const ChatPage: import("react").ComponentType;

  export const i18n: {
    registerNamespace(
      namespace: string,
      resources: Record<string, Record<string, string>>
    ): void;
  };

  export function t(
    key: string,
    options?: { values?: Record<string, unknown> }
  ): string;

  export function useI18n(): {
    t: (key: string, options?: { values?: Record<string, unknown> }) => string;
    locale: string;
  };

  export const UserService: {
    getUserProfile(
      uid: string,
      groupNo?: string,
      options?: { suppressAuthExpiredLogout?: boolean }
    ): Promise<unknown>;
  };

  export const SpaceService: {
    shared: {
      getMySpaces(config?: {
        suppressAuthExpiredLogout?: boolean;
      }): Promise<Array<{ space_id: string; name?: string }>>;
    };
  };

  export interface ConfirmOptions {
    title?: string;
    content?: string | import("react").ReactNode;
    cancelText?: string;
    okText?: string;
    okType?: "danger" | string;
    closeOnEsc?: boolean;
    maskClosable?: boolean;
    onCancel?: () => unknown;
    onOk?: () => unknown;
  }
  export function modalConfirm(options: ConfirmOptions): unknown;

  export class Menus {
    constructor(
      id: string,
      routePath: string,
      title: string,
      icon: import("react").ReactNode,
      selectedIcon: import("react").ReactNode
    );
    onPress?: () => void;
  }

  type EventListener = (...args: any[]) => void;
  export const WKApp: {
    currentMenuId?: string;
    shared: { currentSpaceId?: string };
    remoteConfig: { mailOn: boolean };
    route: {
      register(
        path: string,
        render: () => import("react").ReactNode,
        options?: { hostShell?: () => import("react").ReactNode }
      ): void;
    };
    menus: {
      register(
        id: string,
        factory: () => Menus | undefined,
        order: number
      ): void;
    };
    routeLeft: { popToRoot(): void };
    routeRight: {
      pop(): void;
      push(node: import("react").ReactNode): void;
      replaceToRoot(node: import("react").ReactNode): void;
    };
    mittBus: {
      emit(event: string, ...args: any[]): void;
      on(event: string, listener: EventListener): void;
      off(event: string, listener: EventListener): void;
    };
  };
}
