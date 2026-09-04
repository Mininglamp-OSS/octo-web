import { describe, expect, it } from "vitest"
import { getSpaceRoleBadge } from "../spaceRoleBadge"

describe("getSpaceRoleBadge", () => {
    it("maps the Space admin and owner encodings to the correct badges", () => {
        expect(getSpaceRoleBadge(1)).toEqual({
            className: "admin",
            translationKey: "contacts.role.1",
        })
        expect(getSpaceRoleBadge(2)).toEqual({
            className: "owner",
            translationKey: "contacts.role.2",
        })
    })

    it("does not render a role badge for ordinary or unknown members", () => {
        expect(getSpaceRoleBadge(0)).toBeUndefined()
        expect(getSpaceRoleBadge(3)).toBeUndefined()
        expect(getSpaceRoleBadge(undefined)).toBeUndefined()
    })
})
