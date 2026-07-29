declare module "virtual:octo-enterprise-modules" {
  import type { IModule } from "@octo/base";
  import type { ReactElement } from "react";

  export interface EnterpriseModulesContext {
    registerModule(module: IModule): void;
  }

  export interface EnterpriseStandaloneHandlerContext {
    pathname: string;
    search: string;
    onSessionExpired: () => void;
  }

  export interface EnterpriseStandaloneHandler {
    id: string;
    match(pathname: string): boolean;
    render(context: EnterpriseStandaloneHandlerContext): ReactElement | null;
    persistReturnOnAnonymous?: boolean;
  }

  export function registerEnterpriseModules(context: EnterpriseModulesContext): void;
  export function getEnterpriseStandaloneHandlers(): EnterpriseStandaloneHandler[];
}
