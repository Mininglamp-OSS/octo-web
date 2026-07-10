import { httpPost } from "./http";

export function issueMulticaCliToken(): Promise<{ token: string }> {
  return httpPost<{ token: string }>("/cli-token");
}
