export type ProfileContactValue =
  | { kind: "value"; value: string }
  | { kind: "empty" };

export interface ProfileContactInfo {
  phone?: ProfileContactValue;
  email?: ProfileContactValue;
}

const EMPTY_VALUE = { kind: "empty" } as const;

function readStringContact(
  source: Record<string, unknown> | undefined,
  key: "phone" | "email",
  isValid: (value: string) => boolean
): ProfileContactValue | undefined {
  if (!source || !Object.prototype.hasOwnProperty.call(source, key)) {
    return undefined;
  }

  const value = source[key];
  if (value === "") {
    return EMPTY_VALUE;
  }
  if (typeof value !== "string" || value.trim() !== value || !isValid(value)) {
    return undefined;
  }
  return { kind: "value", value };
}

function isPhone(value: string): boolean {
  return /^\+?[0-9][0-9()\-\s]{0,31}$/.test(value);
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(value);
}

/**
 * Contact values are deliberately read only from the profile response. A
 * missing or malformed property is not equivalent to an empty profile field:
 * the former can mean the server withheld it for the current viewer.
 */
export function getProfileContactInfo(
  source: Record<string, unknown> | undefined
): ProfileContactInfo {
  return {
    phone: readStringContact(source, "phone", isPhone),
    email: readStringContact(source, "email", isEmail),
  };
}

function readCountryCode(
  source: Record<string, unknown> | undefined
): string | undefined {
  if (!source) return undefined;
  for (const key of [
    "phone_country_code",
    "phone_code",
    "country_code",
    "area_code",
  ]) {
    const value = source[key];
    if (typeof value === "string" && /^\+?\d{1,4}$/.test(value)) {
      return value.replace(/^\+/, "");
    }
    if (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value > 0 &&
      value < 10_000
    ) {
      return String(value);
    }
  }
  return undefined;
}

/** The public card hides a country calling code, while self profile keeps it. */
export function phoneWithoutCountryCode(
  phone: string,
  source?: Record<string, unknown>
): string {
  const countryCode = readCountryCode(source);
  if (countryCode) {
    const expression = new RegExp(`^\\+?${countryCode}(?:[\\s-]+|(?=\\d))`);
    const withoutCode = phone.replace(expression, "");
    if (withoutCode !== phone) return withoutCode.trim();
  }

  // Historical Chinese profiles did not consistently include a separate code.
  return phone.replace(/^\+?86(?:[\s-]+|(?=1\d{10}$))/, "").trim();
}

export function truncateContactEmail(email: string, maxLength = 100): string {
  if (email.length <= maxLength) return email;
  return `${email.slice(0, Math.max(0, maxLength - 1))}…`;
}
