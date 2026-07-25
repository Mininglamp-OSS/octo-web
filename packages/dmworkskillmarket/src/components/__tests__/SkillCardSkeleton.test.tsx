import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SkillCardSkeleton from "../SkillCardSkeleton";

describe("SkillCardSkeleton", () => {
  it("renders skeleton structure with title, tags, and description placeholders", () => {
    const { container } = render(<SkillCardSkeleton />);
    expect(container.querySelector(".skill-market-card-skeleton")).toBeTruthy();
    expect(container.querySelector(".skill-market-card-skeleton__title")).toBeTruthy();
    expect(container.querySelectorAll(".skill-market-card-skeleton__tag")).toHaveLength(3);
    expect(container.querySelectorAll(".skill-market-card-skeleton__line")).toHaveLength(2);
  });

  it("is hidden from assistive technology", () => {
    const { container } = render(<SkillCardSkeleton />);
    expect(container.querySelector("[aria-hidden='true']")).toBeTruthy();
  });
});
