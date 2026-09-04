export interface SpaceRoleBadge {
    className: "admin" | "owner"
    translationKey: "contacts.role.1" | "contacts.role.2"
}

/** Space roles use octo-server's 0=member, 1=admin, 2=owner encoding. */
export function getSpaceRoleBadge(role: number | undefined): SpaceRoleBadge | undefined {
    if (role === 1) {
        return { className: "admin", translationKey: "contacts.role.1" }
    }
    if (role === 2) {
        return { className: "owner", translationKey: "contacts.role.2" }
    }
    return undefined
}
