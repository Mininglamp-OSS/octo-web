export type ImMessageContentFactory<TContent = unknown> = () => TContent;

export interface ImMessageContentRuntimeSdk<TContent = unknown> {
  register: (
    contentType: number,
    factory: ImMessageContentFactory<TContent>
  ) => void;
  isSystemMessage: (contentType: number) => boolean;
}

export function registerImMessageContent<TContent>(
  sdk: ImMessageContentRuntimeSdk<TContent>,
  contentType: number,
  factory: ImMessageContentFactory<TContent>
) {
  sdk.register(contentType, factory);
}

export function isImSystemMessage(
  sdk: ImMessageContentRuntimeSdk,
  contentType: number
) {
  return sdk.isSystemMessage(contentType);
}
