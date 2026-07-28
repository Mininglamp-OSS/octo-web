import type { Space } from '../bridge/types';

/**
 * Display name for a space. Every user has exactly one personal space per octo
 * space, so its backend name (historically `"Personal:" + uid`) carries no
 * useful information — render the fixed "个人空间" label instead. Shared spaces
 * keep their user-given name. SSOT for space-name rendering across the sidebar,
 * breadcrumb, and modals.
 */
export function spaceDisplayName(
  space: Pick<Space, 'type' | 'name'>,
  t: (key: string) => string,
): string {
  return space.type === 'personal' ? t('drive.space.personal') : space.name;
}
