import React, { createContext, useContext } from "react";
import { legacySummaryMessagingPort } from "./legacySummaryMessaging";
import type { SummaryMessagingPort } from "./types";

const SummaryMessagingContext = createContext<SummaryMessagingPort>(
  legacySummaryMessagingPort
);

export const SummaryMessagingProvider = SummaryMessagingContext.Provider;

export function useSummaryMessaging(): SummaryMessagingPort {
  return useContext(SummaryMessagingContext);
}
