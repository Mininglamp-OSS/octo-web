import { httpPost } from "./http";

export function issueLoopCliToken(): Promise<{ token: string }> {
  return httpPost<{ token: string }>("/cli-token");
}
