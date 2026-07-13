import { isAgentProgressCard } from "../cardLayout";

function hasInlineFill(el: HTMLElement): boolean {
  const value = el.style.backgroundColor.trim();
  return value.length > 0 && value !== "transparent";
}

export function enhanceAgentProgressLayout(
  card: Record<string, unknown>,
  target: HTMLElement
): void {
  if (!isAgentProgressCard(card)) return;
  const timeline = target.querySelector<HTMLElement>("#timeline_detail");
  if (!timeline) return;

  for (const child of Array.from(timeline.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (!child.classList.contains("ac-container")) continue;

    child.classList.add("wk-interactive-card-progress-step");
    if (hasInlineFill(child)) {
      child.classList.add("wk-interactive-card-progress-step--status");
      child.style.backgroundColor = "";
      child.style.padding = "";
    }
  }
}

export default enhanceAgentProgressLayout;
