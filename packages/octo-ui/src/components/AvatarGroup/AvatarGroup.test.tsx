import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Avatar from "../Avatar";
import AvatarGroup from "./index";

const avatars = [
  <Avatar key="one" alt="One" fallbackText="A" />,
  <Avatar key="two" alt="Two" fallbackText="B" />,
  <Avatar key="three" alt="Three" fallbackText="C" />,
  <Avatar key="four" alt="Four" fallbackText="D" />,
];

describe("AvatarGroup", () => {
  it("uses the required group size for every child", () => {
    const html = renderToStaticMarkup(
      <AvatarGroup size={16} label="Participants">
        {avatars.slice(0, 2)}
      </AvatarGroup>
    );

    expect(html).toContain("octo-ui-avatar-group--size-16");
    expect(html.match(/octo-ui-avatar--size-16/g)).toHaveLength(2);
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Participants"');
  });

  it("shows at most three avatars without an overflow item", () => {
    const html = renderToStaticMarkup(
      <AvatarGroup size={20}>{avatars}</AvatarGroup>
    );

    expect(html.match(/octo-ui-avatar-group__item/g)).toHaveLength(3);
    expect(html).not.toContain("Four");
    expect(html).not.toContain("+1");
  });

  it("supports a lower explicit maximum without changing source order", () => {
    const html = renderToStaticMarkup(
      <AvatarGroup size={20} max={2}>
        {avatars}
      </AvatarGroup>
    );

    expect(html).toContain('aria-label="One"');
    expect(html).toContain('aria-label="Two"');
    expect(html).not.toContain("Three");
    expect(html.indexOf('aria-label="One"')).toBeLessThan(
      html.indexOf('aria-label="Two"')
    );
  });
});
