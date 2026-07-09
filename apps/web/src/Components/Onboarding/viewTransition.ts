import { flushSync } from "react-dom";

type OnboardingViewTransitionOptions = {
    duration?: number;
    onTransition: () => void;
};

type ViewTransitionDocument = Document & {
    startViewTransition?: (callback: () => void) => {
        ready?: Promise<void>;
        finished?: Promise<void>;
    };
};

function getCircleClipPaths(cx: number, cy: number, maxRadius: number): [string, string] {
    return [`circle(0px at ${cx}px ${cy}px)`, `circle(${maxRadius}px at ${cx}px ${cy}px)`];
}

export function runOnboardingViewTransition({ duration = 1240, onTransition }: OnboardingViewTransitionOptions) {
    const transitionDocument = document as ViewTransitionDocument;

    if (typeof transitionDocument.startViewTransition !== "function") {
        return false;
    }

    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const x = viewportWidth / 2;
    const y = viewportHeight / 2;
    const maxRadius = Math.hypot(Math.max(x, viewportWidth - x), Math.max(y, viewportHeight - y));
    const clipPath = getCircleClipPaths(x, y, maxRadius);
    const root = document.documentElement;

    const cleanup = () => {
        delete root.dataset.octoOnboardingVt;
        root.style.removeProperty("--wk-onboarding-vt-duration");
        root.style.removeProperty("--wk-onboarding-vt-clip-from");
    };

    root.dataset.octoOnboardingVt = "active";
    root.style.setProperty("--wk-onboarding-vt-duration", `${duration}ms`);
    root.style.setProperty("--wk-onboarding-vt-clip-from", clipPath[0]);

    let transition: ReturnType<NonNullable<ViewTransitionDocument["startViewTransition"]>>;

    try {
        transition = transitionDocument.startViewTransition(() => {
            flushSync(onTransition);
        });
    } catch {
        cleanup();
        return false;
    }

    if (typeof transition.finished?.finally === "function") {
        transition.finished.finally(cleanup).catch(() => {});
    } else {
        cleanup();
    }
    transition.ready?.then(() => {
        document.documentElement.animate(
            { clipPath },
            {
                duration,
                easing: "cubic-bezier(0.42, 0, 0.18, 1)",
                fill: "forwards",
                pseudoElement: "::view-transition-new(root)",
            },
        );
    }).catch(() => {});

    return true;
}
