import type { Action, AdaptiveCard } from "adaptivecards";
import { runtimeCapabilityForEffect } from "./runtimeCapabilities";

export type ActionMessageSource =
  | { type: "action.title" }
  | { type: "choice_labels"; inputId: string; separator?: string }
  | { type: "input_text"; inputId: string }
  | { type: "compose"; parts: ActionMessageSource[]; separator?: string };

export interface ActionMessageEffect {
  effect: "append_user_message" | "send_current_user_message";
  version: number;
  required: boolean;
  source: ActionMessageSource;
}

export class UnsupportedActionMessageEffectError extends Error {
  constructor(effect: string) {
    super(`Unsupported card action effect: ${effect}`);
    this.name = "UnsupportedActionMessageEffectError";
  }
}

export class InvalidActionMessageSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidActionMessageSourceError";
  }
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function parseSource(value: unknown): ActionMessageSource | undefined {
  if (!isObject(value) || typeof value.type !== "string") return undefined;
  const inputId = stringValue(value.input_id ?? value.inputId);
  if (value.type === "action.title") return { type: "action.title" };
  if (value.type === "choice_labels" && inputId) {
    return {
      type: "choice_labels",
      inputId,
      ...(typeof value.separator === "string"
        ? { separator: value.separator }
        : {}),
    };
  }
  if (value.type === "input_text" && inputId) {
    return { type: "input_text", inputId };
  }
  if (value.type === "compose" && Array.isArray(value.parts)) {
    const parts = value.parts.map(parseSource);
    if (
      parts.every((part): part is ActionMessageSource => part !== undefined)
    ) {
      return {
        type: "compose",
        parts,
        ...(typeof value.separator === "string"
          ? { separator: value.separator }
          : {}),
      };
    }
  }
  return undefined;
}

function findLegacyChoiceInput(card: AdaptiveCard): string | undefined {
  return card.getAllInputs().find((input) => {
    const candidate = input as unknown as { choices?: unknown };
    return Array.isArray(candidate.choices) && typeof input.id === "string";
  })?.id;
}

/** Resolve the Web-executed effect. Cards without an effect keep the old path. */
export function resolveActionMessageEffect(
  action: Action,
  card: AdaptiveCard
): ActionMessageEffect | null {
  const data = (action as unknown as { data?: unknown }).data;
  if (!isObject(data) || data.effect === undefined) return null;
  if (typeof data.effect !== "string") {
    throw new InvalidActionMessageSourceError(
      "Card action effect must be a string"
    );
  }

  const capability = runtimeCapabilityForEffect(data.effect);
  if (
    !capability ||
    capability.status !== "supported" ||
    (data.effect !== "append_user_message" &&
      data.effect !== "send_current_user_message")
  ) {
    if (data.effect_required !== false) {
      throw new UnsupportedActionMessageEffectError(data.effect);
    }
    return null;
  }

  const version =
    typeof data.effect_version === "number" ? data.effect_version : 1;
  if (!Number.isInteger(version) || version < 1) {
    throw new InvalidActionMessageSourceError(
      "Card action effect_version must be a positive integer"
    );
  }
  if (version > capability.version) {
    if (data.effect_required === false) return null;
    throw new UnsupportedActionMessageEffectError(`${data.effect}@${version}`);
  }

  // append_user_message was shipped before message_source existed. Infer only its
  // historical ChoiceSet behavior; new cards must declare the source explicitly.
  const hasDeclaredSource =
    Object.prototype.hasOwnProperty.call(data, "message_source") ||
    Object.prototype.hasOwnProperty.call(data, "messageSource");
  const declaredSource = data.message_source ?? data.messageSource;
  const parsedSource = parseSource(declaredSource);
  if (hasDeclaredSource && !parsedSource) {
    throw new InvalidActionMessageSourceError(
      "Card action message_source is malformed"
    );
  }
  const source =
    parsedSource ??
    (data.effect === "append_user_message"
      ? (() => {
          const inputId = findLegacyChoiceInput(card);
          return inputId
            ? ({ type: "choice_labels", inputId } as ActionMessageSource)
            : ({ type: "action.title" } as ActionMessageSource);
        })()
      : undefined);
  if (!source) {
    throw new InvalidActionMessageSourceError(
      "Current-user message effect requires a supported message_source"
    );
  }

  return {
    effect: data.effect,
    version,
    required: data.effect_required !== false,
    source,
  };
}

interface CardInputLike {
  id?: string;
  value?: unknown;
  choices?: Array<{ title?: string; value?: string }>;
}

function inputFor(card: AdaptiveCard, inputId: string): CardInputLike {
  const input = card.getAllInputs().find((item) => item.id === inputId) as
    | CardInputLike
    | undefined;
  if (!input)
    throw new InvalidActionMessageSourceError(`Unknown card input: ${inputId}`);
  return input;
}

function resolveSourceText(
  source: ActionMessageSource,
  card: AdaptiveCard,
  action: Action
): string {
  if (source.type === "action.title") {
    const title = (action as unknown as { title?: unknown }).title;
    if (typeof title !== "string" || !title.trim()) {
      throw new InvalidActionMessageSourceError("Action.title is empty");
    }
    return title.trim();
  }
  if (source.type === "input_text") {
    const value = inputFor(card, source.inputId).value;
    return value == null ? "" : String(value).trim();
  }
  if (source.type === "choice_labels") {
    const input = inputFor(card, source.inputId);
    if (!Array.isArray(input.choices)) {
      throw new InvalidActionMessageSourceError(
        `Input ${source.inputId} is not a ChoiceSet`
      );
    }
    const rawValue = input.value == null ? "" : String(input.value);
    const values = rawValue
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const labels = values.map((value) => {
      const choice = input.choices?.find((item) => item.value === value);
      if (!choice?.title) {
        throw new InvalidActionMessageSourceError(
          `Choice value is not declared by ${source.inputId}: ${value}`
        );
      }
      return choice.title.trim();
    });
    return labels.join(source.separator ?? "\n");
  }
  const parts = source.parts
    .map((part) => resolveSourceText(part, card, action).trim())
    .filter(Boolean);
  return parts.join(source.separator ?? "\n");
}

export function resolveActionMessageText(
  effect: ActionMessageEffect,
  action: Action,
  card: AdaptiveCard
): string {
  const text = resolveSourceText(effect.source, card, action).trim();
  if (!text)
    throw new InvalidActionMessageSourceError("Current-user message is empty");
  return text;
}
