export const DESKTOP_MOTION_EVENTS = [
  "transitionrun", "transitionend", "transitioncancel",
  "animationstart", "animationend", "animationcancel",
];

export function desktopMotionKey(event: Event): string {
  const motion = event as TransitionEvent & AnimationEvent;
  const transition = event.type.startsWith("transition");
  return JSON.stringify([
    transition ? "transition" : "animation",
    transition ? motion.propertyName : motion.animationName,
    motion.pseudoElement ?? "",
  ]);
}

export function isDesktopMotionActive(animation: Animation): boolean {
  return animation.playState !== "idle" && animation.playState !== "finished" &&
    Number.isFinite(animation.effect?.getComputedTiming().endTime);
}

export function isDesktopMotionRunning(animation: Animation): boolean {
  return isDesktopMotionActive(animation) && animation.playState === "running" && animation.playbackRate !== 0;
}

/** Match the browser's animation object, including its pseudo-element and lifetime. */
export function getDesktopMotion(element: Element, event: Event): Animation | undefined {
  const motion = event as TransitionEvent & AnimationEvent;
  return element.getAnimations?.().find(animation => {
    const matches = event.type.startsWith("transition")
      ? "transitionProperty" in animation && animation.transitionProperty === motion.propertyName
      : "animationName" in animation && animation.animationName === motion.animationName;
    const effect = animation.effect as KeyframeEffect | null;
    return matches && (effect?.pseudoElement ?? "") === (motion.pseudoElement ?? "") &&
      isDesktopMotionActive(animation);
  });
}
