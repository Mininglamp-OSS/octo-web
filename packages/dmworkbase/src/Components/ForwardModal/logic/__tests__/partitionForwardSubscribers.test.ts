import { describe, expect, it } from "vitest"
import { partitionForwardSubscribers } from "../partitionForwardSubscribers"

describe("partitionForwardSubscribers", () => {
  it("separates humans, Bots, and unknown identities", () => {
    const result = partitionForwardSubscribers([
      { uid: "u_human", orgData: { robot: 0 } },
      { uid: "u_bot", orgData: { robot: 1 } },
      { uid: "u_unknown" },
      { uid: "" },
    ])

    expect(result.humans.map((member) => member.uid)).toEqual(["u_human"])
    expect(result.bots.map((member) => member.uid)).toEqual(["u_bot"])
    expect(result.unknown.map((member) => member.uid)).toEqual(["u_unknown"])
  })

  it("uses the Space Bot roster as positive evidence and lets Bot win conflicts", () => {
    const result = partitionForwardSubscribers(
      [
        { uid: "u_roster_bot" },
        { uid: "u_conflict", orgData: { robot: 0 } },
        { uid: "u_conflict", orgData: { robot: 1 } },
      ],
      new Set(["u_roster_bot"]),
    )

    expect(result.humans).toEqual([])
    expect(result.unknown).toEqual([])
    expect(result.bots.map((member) => member.uid)).toEqual([
      "u_roster_bot",
      "u_conflict",
    ])
  })

  it("does not coerce truthy non-numeric robot values into Bots", () => {
    const result = partitionForwardSubscribers([
      { uid: "u_string", orgData: { robot: "1" } },
      { uid: "u_boolean", orgData: { robot: true } },
      { uid: "u_null", orgData: { robot: null } },
    ])

    expect(result.humans).toEqual([])
    expect(result.bots).toEqual([])
    expect(result.unknown.map((member) => member.uid)).toEqual([
      "u_string",
      "u_boolean",
      "u_null",
    ])
  })
})
