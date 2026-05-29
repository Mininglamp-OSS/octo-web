import APIClient from "./APIClient";
import { Locale } from "../i18n/types";

export function updateUserLanguagePreference(language: Locale | ""): Promise<unknown> {
  return APIClient.shared.put("/user/language", { language });
}
