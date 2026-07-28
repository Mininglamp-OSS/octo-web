declare module "virtual:octo-enterprise-modules" {
  import type { IModule } from "@octo/base";
  import type { ReactElement } from "react";

  export interface EnterpriseModulesContext {
    registerModule(module: IModule): void;
  }

  export interface EnterpriseStandaloneDocCapability {
    isStandaloneDocPath(pathname: string): boolean;
    parseStandaloneDocId(pathname: string): string | null;
    renderStandaloneDocPage(props: {
      docId: string | null;
      onSessionExpired: () => void;
    }): ReactElement;
  }

  export function registerEnterpriseModules(context: EnterpriseModulesContext): void;
  export function getEnterpriseStandaloneDocCapability(): EnterpriseStandaloneDocCapability | null;
}
