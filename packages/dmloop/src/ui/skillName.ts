export const SKILL_NAME_PATTERN = /^[A-Za-z0-9-]+$/;

export function isValidSkillName(name: string): boolean {
  return SKILL_NAME_PATTERN.test(name.trim());
}
