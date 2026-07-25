import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  Check,
  ExternalLink,
  Github,
  Sparkles,
  X,
} from "lucide-react";
import { useI18n } from "@octo/base";
import {
  defaultOnboardingConfig,
  markOnboardingSeen,
  resolveOnboardingSections,
  shouldShowOnboarding,
  type OnboardingConfig,
  type ResolvedOnboardingSection,
} from "./content";
import { OnboardingIntro } from "./Intro";
import { OnboardingHoverButton } from "./HoverButton";
import { runOnboardingViewTransition } from "./viewTransition";
import "./index.css";

const COMPLETION_CELEBRATION_MS = 1180;
const COMPLETION_REDUCED_MOTION_MS = 120;
const CELEBRATION_COLORS = [
  "#7C3AED",
  "#06B6D4",
  "#F59E0B",
  "#10B981",
  "#F8FAFC",
] as const;
const CELEBRATION_PARTICLES = Array.from({ length: 46 }, (_, index) => {
  const lane = index % 23;
  const ring = Math.floor(index / 23);
  const angle = (-168 + lane * 7.2) * (Math.PI / 180);
  const distance = ring === 0 ? 110 + (lane % 4) * 12 : 154 + (lane % 5) * 14;

  return {
    id: index,
    tx: `${Math.round(Math.cos(angle) * distance)}px`,
    ty: `${Math.round(Math.sin(angle) * distance)}px`,
    rotate: `${ring === 0 ? 140 + lane * 17 : -120 - lane * 13}deg`,
    delay: `${ring * 44 + lane * 11}ms`,
    color: CELEBRATION_COLORS[lane % CELEBRATION_COLORS.length],
  };
});

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type OnboardingSectionId = ResolvedOnboardingSection["id"];
const preloadedOnboardingImages = new Map<string, HTMLImageElement>();

type OnboardingProps = {
  config?: OnboardingConfig;
  forceVisible?: boolean;
  onDismiss?: () => void;
  skipIntro?: boolean;
};

function isExternalLinkSection(section: ResolvedOnboardingSection) {
  return section.action?.type === "external-link";
}

function isFinishSection(section: ResolvedOnboardingSection) {
  return section.action?.type === "finish";
}

function getDescriptionParts(description: string) {
  const [lead, ...support] = description
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return { lead, support };
}

function isIntroPreviewMode() {
  return new URLSearchParams(window.location.search).get("intro") === "1";
}

function getCompletionCloseDelay() {
  const reduceMotion = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  return reduceMotion
    ? COMPLETION_REDUCED_MOTION_MS
    : COMPLETION_CELEBRATION_MS;
}

function getElementCenter(element: HTMLElement | null) {
  if (element) {
    const rect = element.getBoundingClientRect();

    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }

  return {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  };
}

function getCompletionOrigin(
  event?: React.MouseEvent<HTMLButtonElement>,
  fallbackElement?: HTMLButtonElement | null
) {
  if (event && (event.clientX > 0 || event.clientY > 0)) {
    return {
      x: event.clientX,
      y: event.clientY,
    };
  }

  return getElementCenter(event?.currentTarget || fallbackElement || null);
}

function getFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  ).filter((element) => {
    if (element.getAttribute("aria-hidden") === "true") return false;
    if (element.hasAttribute("disabled")) return false;
    return element.offsetParent !== null || element === document.activeElement;
  });
}

function focusElement(element: HTMLElement | null) {
  element?.focus({ preventScroll: true });
}

function preloadOnboardingImages(
  sections: ResolvedOnboardingSection[],
  currentImageSrc: string
) {
  sections.forEach((section) => {
    if (
      section.image === currentImageSrc ||
      preloadedOnboardingImages.has(section.image)
    ) {
      return;
    }

    const image = new Image();
    image.decoding = "async";
    image.src = section.image;
    preloadedOnboardingImages.set(section.image, image);
    void image.decode?.().catch(() => undefined);
  });
}

function ImageVisual({ section }: { section: ResolvedOnboardingSection }) {
  return (
    <img
      className={`wk-onboarding-image${
        section.imageFit === "contain" ? " is-contain" : ""
      }`}
      src={section.image}
      alt={section.visualTitle}
      decoding="async"
    />
  );
}

export const Onboarding: React.FC<OnboardingProps> = ({
  config = defaultOnboardingConfig,
  forceVisible = false,
  onDismiss,
  skipIntro = false,
}) => {
  const { locale, t } = useI18n();
  const introPreviewMode = useMemo(() => isIntroPreviewMode(), []);
  const onboardingSections = useMemo(
    () => resolveOnboardingSections(config, t),
    [config, t]
  );
  const [activeId, setActiveId] = useState<OnboardingSectionId>("workspace");
  const [completionOrigin, setCompletionOrigin] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [visible, setVisible] = useState(() => {
    if (forceVisible) return true;
    return shouldShowOnboarding(config, window.localStorage);
  });
  const [showIntro, setShowIntro] = useState(() => {
    if (skipIntro) return false;
    if (introPreviewMode) return true;
    return !!config.intro.enabled;
  });
  const [introLeaving, setIntroLeaving] = useState(false);
  const [isIntroSkipTransitionTarget, setIsIntroSkipTransitionTarget] =
    useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const finishButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const completionStartedRef = useRef(false);
  const introTransitionStartedRef = useRef(false);
  const completionTimerRef = useRef<number | null>(null);
  const introFallbackTimerRef = useRef<number | null>(null);
  const focusTimerRef = useRef<number | null>(null);

  const activeSection =
    onboardingSections.find((section) => section.id === activeId) ||
    onboardingSections[0];
  const isFinalSection =
    activeSection?.id === onboardingSections[onboardingSections.length - 1]?.id;
  const descriptionParts = activeSection
    ? getDescriptionParts(activeSection.description)
    : null;

  useEffect(() => {
    return () => {
      if (completionTimerRef.current !== null) {
        window.clearTimeout(completionTimerRef.current);
      }
      if (introFallbackTimerRef.current !== null) {
        window.clearTimeout(introFallbackTimerRef.current);
      }
      if (focusTimerRef.current !== null) {
        window.clearTimeout(focusTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!visible || forceVisible) return;
    try {
      markOnboardingSeen(window.localStorage);
    } catch {
      // Some hardened browsers throw on localStorage writes; onboarding still closes normally.
    }
  }, [forceVisible, visible]);

  useEffect(() => {
    if (!visible || showIntro || !activeSection) return;

    const preloadTimer = window.setTimeout(() => {
      preloadOnboardingImages(onboardingSections, activeSection.image);
    }, 0);

    return () => window.clearTimeout(preloadTimer);
  }, [activeSection, onboardingSections, showIntro, visible]);

  const persistDismissed = () => {
    try {
      markOnboardingSeen(window.localStorage);
    } catch {
      // Best-effort persistence only.
    }
  };

  const hideOnboarding = () => {
    setVisible(false);
    onDismiss?.();
  };

  const handleClose = () => {
    if (isCompleting) return;

    if (isFinalSection) {
      handleFinish();
      return;
    }

    persistDismissed();
    hideOnboarding();
  };

  const handleFinish = (event?: React.MouseEvent<HTMLButtonElement>) => {
    if (completionStartedRef.current) return;

    completionStartedRef.current = true;
    setCompletionOrigin(getCompletionOrigin(event, finishButtonRef.current));
    persistDismissed();
    setIsCompleting(true);
    completionTimerRef.current = window.setTimeout(() => {
      completionTimerRef.current = null;
      hideOnboarding();
    }, getCompletionCloseDelay());
  };

  const handleIntroContinue = () => {
    if (introLeaving || introTransitionStartedRef.current) return;
    introTransitionStartedRef.current = true;

    const transitioned = runOnboardingViewTransition({
      duration: 1240,
      onTransition: () => {
        setShowIntro(false);
        setIntroLeaving(false);
        introTransitionStartedRef.current = false;
      },
    });
    if (transitioned) return;

    setIntroLeaving(true);
    introFallbackTimerRef.current = window.setTimeout(() => {
      introFallbackTimerRef.current = null;
      setShowIntro(false);
      setIntroLeaving(false);
      introTransitionStartedRef.current = false;
    }, 620);
  };

  const handleIntroSkip = () => {
    if (introLeaving || introTransitionStartedRef.current) return;
    introTransitionStartedRef.current = true;

    const closeIntro = () => {
      hideOnboarding();
      setIsIntroSkipTransitionTarget(false);
      setIntroLeaving(false);
      introTransitionStartedRef.current = false;
    };

    persistDismissed();
    const transitioned = runOnboardingViewTransition({
      duration: 1240,
      onTransition: () => setIsIntroSkipTransitionTarget(true),
      onFinished: closeIntro,
    });
    if (transitioned) return;

    setIntroLeaving(true);
    introFallbackTimerRef.current = window.setTimeout(() => {
      introFallbackTimerRef.current = null;
      closeIntro();
    }, 620);
  };

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusableElements = getFocusableElements(dialog);
    if (focusableElements.length === 0) {
      event.preventDefault();
      focusElement(dialog);
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;

    if (event.shiftKey) {
      if (
        activeElement === firstElement ||
        activeElement === dialog ||
        !dialog.contains(activeElement)
      ) {
        event.preventDefault();
        focusElement(lastElement);
      }
      return;
    }

    if (activeElement === lastElement) {
      event.preventDefault();
      focusElement(firstElement);
    }
  };

  useEffect(() => {
    if (!visible) return;

    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      previousFocusRef.current = activeElement;
    }

    return () => {
      const previousFocus = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previousFocus?.isConnected) {
        focusElement(previousFocus);
      }
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;

    if (focusTimerRef.current !== null) {
      window.clearTimeout(focusTimerRef.current);
    }

    focusTimerRef.current = window.setTimeout(() => {
      focusTimerRef.current = null;
      const dialog = dialogRef.current;
      if (!dialog) return;

      if (showIntro) {
        focusElement(dialog);
        return;
      }

      focusElement(getFocusableElements(dialog)[0] || dialog);
    }, 0);
  }, [showIntro, visible]);

  if (!visible) {
    return null;
  }

  if (!activeSection) {
    return null;
  }

  if (showIntro) {
    return (
      <div
        ref={dialogRef}
        className={`wk-onboarding-overlay wk-onboarding-overlay-intro${
          introLeaving ? " is-intro-leaving" : ""
        }${isIntroSkipTransitionTarget ? " is-skip-transition-target" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-hidden={isIntroSkipTransitionTarget ? true : undefined}
        aria-label={t("app.onboarding.dialog.introAria")}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
      >
        <OnboardingIntro
          onContinue={handleIntroContinue}
          onSkip={handleIntroSkip}
        />
      </div>
    );
  }

  return (
    <div
      ref={dialogRef}
      className={`wk-onboarding-overlay wk-onboarding-overlay-panel${
        isCompleting ? " is-completing" : ""
      }`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="wk-onboarding-title"
      tabIndex={-1}
      onKeyDown={handleDialogKeyDown}
    >
      {isCompleting ? (
        <div
          className="wk-onboarding-celebration"
          aria-hidden="true"
          style={
            completionOrigin
              ? ({
                  "--wk-celebration-x": `${completionOrigin.x}px`,
                  "--wk-celebration-y": `${completionOrigin.y}px`,
                } as React.CSSProperties)
              : undefined
          }
        >
          {CELEBRATION_PARTICLES.map((particle) => (
            <span
              key={particle.id}
              style={
                {
                  "--wk-particle-tx": particle.tx,
                  "--wk-particle-ty": particle.ty,
                  "--wk-particle-rotate": particle.rotate,
                  "--wk-particle-delay": particle.delay,
                  "--wk-particle-color": particle.color,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      ) : null}
      <span className="wk-onboarding-sr-only" role="status" aria-live="polite">
        {isCompleting ? t("app.onboarding.actions.completed") : ""}
      </span>
      <section className="wk-onboarding-panel">
        <aside
          className="wk-onboarding-nav"
          aria-label={t("app.onboarding.dialog.sectionsAria")}
        >
          <div className="wk-onboarding-brand">
            <strong>{t("app.onboarding.nav.welcome")}</strong>
          </div>
          <nav className="wk-onboarding-nav-list">
            {onboardingSections.map((section, index) => (
              <React.Fragment key={section.id}>
                {isFinishSection(section) ? (
                  <div
                    className="wk-onboarding-nav-divider"
                    aria-hidden="true"
                  />
                ) : null}
                <button
                  type="button"
                  className={section.id === activeSection.id ? "is-active" : ""}
                  onClick={() => setActiveId(section.id)}
                >
                  <span className="wk-onboarding-nav-index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="wk-onboarding-nav-label">
                    {section.label}
                  </span>
                </button>
              </React.Fragment>
            ))}
          </nav>
          <div className="wk-onboarding-resource-links">
            <a
              className="wk-onboarding-open-source"
              href={config.links.openSourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              <Github size={15} aria-hidden="true" />
              {t("app.onboarding.links.openSource")}
            </a>
            <a
              className="wk-onboarding-open-source"
              href={
                locale === "en-US"
                  ? config.links.aboutMininglampUrl.enUS
                  : config.links.aboutMininglampUrl.zhCN
              }
              target="_blank"
              rel="noreferrer"
            >
              <Building2 size={15} aria-hidden="true" />
              {t("app.onboarding.links.aboutMininglamp")}
            </a>
          </div>
        </aside>

        <main className="wk-onboarding-content">
          <button
            className="wk-onboarding-close"
            type="button"
            onClick={handleClose}
            aria-label={t("app.onboarding.actions.closeAria")}
          >
            <X size={18} aria-hidden="true" />
          </button>

          <h1 className="wk-onboarding-title" id="wk-onboarding-title">
            {activeSection.title}
          </h1>

          <div
            className="wk-onboarding-media-frame"
            aria-label={activeSection.visualTitle}
          >
            <ImageVisual section={activeSection} />
          </div>

          <p className={`wk-onboarding-description is-${activeSection.id}`}>
            <strong className="wk-onboarding-description-lead">
              {descriptionParts?.lead}
            </strong>
            {descriptionParts?.support.length ? (
              <span className="wk-onboarding-description-support">
                {descriptionParts.support.map((paragraph) => (
                  <span
                    className="wk-onboarding-description-support-line"
                    key={paragraph}
                  >
                    {paragraph}
                  </span>
                ))}
              </span>
            ) : null}
          </p>

          {isExternalLinkSection(activeSection) &&
          activeSection.action?.type === "external-link" ? (
            <div className="wk-onboarding-extension-row">
              <a
                className="wk-onboarding-hover-button is-brand wk-onboarding-extension-action"
                href={activeSection.action.href}
                target="_blank"
                rel="noreferrer"
                aria-label={t(activeSection.action.ariaLabelKey)}
              >
                <span
                  className="wk-onboarding-hover-button-fill"
                  aria-hidden="true"
                />
                <span className="wk-onboarding-hover-button-idle">
                  <span className="wk-onboarding-hover-button-text">
                    {t(activeSection.action.labelKey)}
                  </span>
                  <ExternalLink size={15} aria-hidden="true" />
                </span>
              </a>
            </div>
          ) : null}

          {isFinishSection(activeSection) &&
          activeSection.action?.type === "finish" ? (
            <div className="wk-onboarding-finish-row">
              <OnboardingHoverButton
                ref={finishButtonRef}
                className={`wk-onboarding-finish-button${
                  isCompleting ? " is-complete" : ""
                }`}
                text={
                  isCompleting
                    ? t(activeSection.action.completedLabelKey)
                    : t(activeSection.action.labelKey)
                }
                icon={
                  isCompleting ? (
                    <Check size={15} aria-hidden="true" />
                  ) : (
                    <Sparkles size={15} aria-hidden="true" />
                  )
                }
                variant="brand"
                onClick={handleFinish}
                disabled={isCompleting}
              />
            </div>
          ) : null}
        </main>
      </section>
    </div>
  );
};
