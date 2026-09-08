import type { IModule } from "@octo/base";
import {
  registerSummaryCandidateSearch,
  registerSummaryFoundation,
} from "../runtime/foundation";
import { registerSummaryChatExtension } from "./chatExtension";

let initialized = false;

export class SummaryCommunicationModule implements IModule {
  id(): string {
    return "SummaryCommunicationModule";
  }

  init(): void {
    if (initialized) return;
    initialized = true;
    registerSummaryFoundation();
    registerSummaryCandidateSearch();
    registerSummaryChatExtension();
  }
}
