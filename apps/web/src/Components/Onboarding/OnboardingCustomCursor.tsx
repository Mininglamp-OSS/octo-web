import React, { useEffect, useRef } from "react";

type OnboardingCustomCursorProps = {
    active: boolean;
};

const interactiveSelector = [
    "a[href]",
    "button:not(:disabled)",
    '[role="button"]',
    '[role="link"]',
    'summary',
    'label',
    '[tabindex]:not([tabindex="-1"])',
    '[data-cursor-interactive="true"]',
].join(", ");

const nativeCursorSelector = [
    "input",
    "textarea",
    "select",
    '[contenteditable="true"]',
    '[contenteditable=""]',
    '[data-cursor-native="true"]',
].join(", ");

const hasSelectionInside = (root: HTMLElement) => {
    const selection = document.getSelection();

    if (!selection || selection.isCollapsed || selection.type !== "Range") return false;

    const { anchorNode, focusNode } = selection;
    return Boolean((anchorNode && root.contains(anchorNode)) || (focusNode && root.contains(focusNode)));
};

const addMediaQueryListener = (query: MediaQueryList, listener: () => void) => {
    if (typeof query.addEventListener === "function") {
        query.addEventListener("change", listener);
        return () => query.removeEventListener("change", listener);
    }

    query.addListener(listener);
    return () => query.removeListener(listener);
};

export const OnboardingCustomCursor: React.FC<OnboardingCustomCursorProps> = ({ active }) => {
    const cursorRef = useRef<HTMLDivElement>(null);
    const dotRef = useRef<HTMLSpanElement>(null);
    const ringRef = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        const cursor = cursorRef.current;
        const dot = dotRef.current;
        const ring = ringRef.current;
        const root = cursor?.closest(".wk-onboarding-intro") as HTMLElement | null;

        if (!active || !cursor || !dot || !ring || !root || typeof window.matchMedia !== "function") return;

        const pointerQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
        const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
        let targetX = 0;
        let targetY = 0;
        let ringX = 0;
        let ringY = 0;
        let rafId = 0;
        let initialized = false;
        let interactive = false;
        let lastTarget: EventTarget | null = null;

        const canAnimate = () => pointerQuery.matches && !reducedMotionQuery.matches;

        const stopAnimation = () => {
            if (rafId) {
                window.cancelAnimationFrame(rafId);
                rafId = 0;
            }
        };

        const hideCursor = () => {
            stopAnimation();
            cursor.classList.remove("is-visible", "is-interactive", "is-native");
            root.classList.remove("has-native-cursor");
            interactive = false;
            initialized = false;
            lastTarget = null;
        };

        const animateRing = () => {
            ringX += (targetX - ringX) * 0.2;
            ringY += (targetY - ringY) * 0.2;

            ring.style.transform = `translate3d(${ringX}px, ${ringY}px, 0)`;

            rafId = window.requestAnimationFrame(animateRing);
        };

        const startAnimation = () => {
            if (!rafId && canAnimate()) {
                rafId = window.requestAnimationFrame(animateRing);
            }
        };

        const updateAvailability = () => {
            if (canAnimate()) {
                return;
            }

            stopAnimation();
            hideCursor();
        };

        const syncTargetState = (target: EventTarget | null) => {
            const element = target instanceof Element ? target : null;
            const hasNativeCursor = Boolean(element?.closest(nativeCursorSelector)) || hasSelectionInside(root);

            interactive = Boolean(!hasNativeCursor && element?.closest(interactiveSelector));
            root.classList.toggle("has-native-cursor", hasNativeCursor);
            cursor.classList.toggle("is-native", hasNativeCursor);
            cursor.classList.toggle("is-interactive", interactive);
        };

        const handlePointerMove = (event: PointerEvent) => {
            if (!canAnimate() || (event.pointerType && event.pointerType !== "mouse")) return;

            targetX = event.clientX;
            targetY = event.clientY;

            if (!initialized) {
                ringX = targetX;
                ringY = targetY;
                initialized = true;
            }

            dot.style.transform = `translate3d(${targetX - 3}px, ${targetY - 3}px, 0)`;
            cursor.classList.add("is-visible");
            if (event.target !== lastTarget) {
                lastTarget = event.target;
                syncTargetState(event.target);
            }
            startAnimation();
        };

        const handlePointerLeave = () => {
            hideCursor();
        };

        const handleSelectionChange = () => {
            const selectingText = hasSelectionInside(root);
            root.classList.toggle("has-native-cursor", selectingText);
            cursor.classList.toggle("is-native", selectingText);
            if (selectingText) {
                interactive = false;
                cursor.classList.remove("is-interactive");
            }
        };

        root.addEventListener("pointermove", handlePointerMove, { passive: true });
        root.addEventListener("pointerleave", handlePointerLeave);
        window.addEventListener("blur", hideCursor);
        document.addEventListener("selectionchange", handleSelectionChange);
        const removePointerQueryListener = addMediaQueryListener(pointerQuery, updateAvailability);
        const removeReducedMotionQueryListener = addMediaQueryListener(reducedMotionQuery, updateAvailability);
        updateAvailability();

        return () => {
            root.removeEventListener("pointermove", handlePointerMove);
            root.removeEventListener("pointerleave", handlePointerLeave);
            window.removeEventListener("blur", hideCursor);
            document.removeEventListener("selectionchange", handleSelectionChange);
            removePointerQueryListener();
            removeReducedMotionQueryListener();
            stopAnimation();
            hideCursor();
        };
    }, [active]);

    if (!active) return null;

    return (
        <div className="wk-onboarding-custom-cursor" ref={cursorRef} aria-hidden="true">
            <span className="wk-onboarding-custom-cursor-ring" ref={ringRef}>
                <span className="wk-onboarding-custom-cursor-ring-core" />
            </span>
            <span className="wk-onboarding-custom-cursor-dot" ref={dotRef} />
        </div>
    );
};
