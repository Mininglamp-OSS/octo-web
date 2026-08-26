import { describe, expect, it } from "vitest";
import {
  mapAgentDetail,
  mapAgentListItem,
  mapSquadDetail,
  mapSquadListItem,
} from "./expertWire";

describe("expertWire metric counts", () => {
  it("maps view_count / install_count onto list items", () => {
    const agent = mapAgentListItem({
      expert_id: "e1",
      name: "后端架构师",
      view_count: 128,
      install_count: 6,
    });
    expect(agent.viewCount).toBe(128);
    expect(agent.installCount).toBe(6);

    const squad = mapSquadListItem({
      squad_id: "s1",
      name: "软件研发交付团",
      view_count: 42,
      install_count: 3,
    });
    expect(squad.viewCount).toBe(42);
    expect(squad.installCount).toBe(3);
  });

  it("defaults missing counts to 0 (legacy wire records)", () => {
    expect(mapAgentListItem({ expert_id: "e1" }).viewCount).toBe(0);
    expect(mapAgentListItem({ expert_id: "e1" }).installCount).toBe(0);
    expect(mapSquadListItem({ squad_id: "s1" }).viewCount).toBe(0);
    expect(mapSquadListItem({ squad_id: "s1" }).installCount).toBe(0);
  });

  it("carries counts through the detail projections", () => {
    const agent = mapAgentDetail({
      expert_id: "e1",
      view_count: 7,
      install_count: 2,
    });
    expect(agent.viewCount).toBe(7);
    expect(agent.installCount).toBe(2);

    const squad = mapSquadDetail({
      squad_id: "s1",
      view_count: 9,
      install_count: 4,
      members: [],
    });
    expect(squad.viewCount).toBe(9);
    expect(squad.installCount).toBe(4);
  });
});
