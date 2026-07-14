import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { X } from "lucide-react";
import { useI18n } from "@octo/base";
import { OnboardingHoverButton } from "./HoverButton";
import NarrativeRail from "./NarrativeRail";
import { OnboardingCustomCursor } from "./OnboardingCustomCursor";
import SilkBackground from "./SilkBackground";
import Strands from "./Strands";
import TrueFocus from "./TrueFocus";

const logoSrc = new URL("./assets/octo-logo-white-symbol.png", import.meta.url)
  .href;

const narrativeDurations = [2150, 2150, 2900];
const CONTENT_TRANSITION_MS = 280;
const SILK_SHIFT_OUT_MS = 260;
const SILK_SHIFT_REVEAL_MS = 560;
const SILK_AUTO_CONTINUE_MS = 7200;

const silkBackdropSettings = {
  opening: {
    hue: 252,
    saturation: 0.62,
    brightness: 0.98,
    speed: 0.28,
    mouseSensitivity: 0.42,
    damping: 0.08,
    textureScale: 0.78,
  },
  meaning: {
    hue: 266,
    saturation: 0.68,
    brightness: 0.95,
    speed: 0.34,
    mouseSensitivity: 0.48,
    damping: 0.09,
    textureScale: 0.96,
  },
  silk: {
    hue: 238,
    saturation: 0.58,
    brightness: 0.91,
    speed: 0.48,
    mouseSensitivity: 0.54,
    damping: 0.1,
    textureScale: 1.18,
  },
};

type OnboardingIntroProps = {
  onContinue: () => void;
  onSkip: () => void;
};

type IntroPhase = "opening" | "meaning" | "silk";
type PhaseTransitionMode = "none" | "content" | "silkShift";

export const OnboardingIntro: React.FC<OnboardingIntroProps> = ({
  onContinue,
  onSkip,
}) => {
  const { t } = useI18n();
  const [phase, setPhase] = useState<IntroPhase>("opening");
  const [phaseTransitionMode, setPhaseTransitionMode] =
    useState<PhaseTransitionMode>("none");
  const [isSilkRevealed, setIsSilkRevealed] = useState(false);
  const [activeMeaningIndex, setActiveMeaningIndex] = useState(0);
  const transitionTimerRefs = useRef<number[]>([]);
  const continueStartedRef = useRef(false);
  const octoMeanings = useMemo(
    () => [
      {
        word: "Open",
        title: t("app.onboarding.intro.meanings.open.title"),
        description: t("app.onboarding.intro.meanings.open.description"),
      },
      {
        word: "Context",
        title: t("app.onboarding.intro.meanings.context.title"),
        description: t("app.onboarding.intro.meanings.context.description"),
      },
      {
        word: "Taste",
        title: t("app.onboarding.intro.meanings.taste.title"),
        description: t("app.onboarding.intro.meanings.taste.description"),
      },
      {
        word: "Orchestration",
        title: t("app.onboarding.intro.meanings.orchestration.title"),
        description: t(
          "app.onboarding.intro.meanings.orchestration.description"
        ),
      },
    ],
    [t]
  );
  const narrativeItems = useMemo(
    () => [
      {
        title: t("app.onboarding.intro.narrative.judgment"),
      },
      {
        title: t("app.onboarding.intro.narrative.agent"),
      },
      {
        title: t("app.onboarding.intro.narrative.octo"),
        emoji: "👋",
      },
    ],
    [t]
  );
  const activeMeaning = octoMeanings[activeMeaningIndex] || octoMeanings[0];
  const focusSentence = octoMeanings.map((meaning) => meaning.word).join(" ");
  const silkBackdrop = silkBackdropSettings[phase];

  const clearTransitionTimers = () => {
    transitionTimerRefs.current.forEach((timer) => window.clearTimeout(timer));
    transitionTimerRefs.current = [];
  };

  const goToPhase = (nextPhase: Exclude<IntroPhase, "opening">) => {
    if (phaseTransitionMode !== "none" || nextPhase === phase) return;

    clearTransitionTimers();

    if (nextPhase === "silk") {
      setIsSilkRevealed(false);
      setPhaseTransitionMode("silkShift");

      const swapTimer = window.setTimeout(() => {
        setPhase(nextPhase);
      }, SILK_SHIFT_OUT_MS);

      const revealTimer = window.setTimeout(() => {
        setPhaseTransitionMode("none");
        setIsSilkRevealed(true);
        transitionTimerRefs.current = [];
      }, SILK_SHIFT_OUT_MS + SILK_SHIFT_REVEAL_MS);

      transitionTimerRefs.current = [swapTimer, revealTimer];
      return;
    }

    setIsSilkRevealed(false);
    setPhaseTransitionMode("content");

    const timer = window.setTimeout(() => {
      setPhase(nextPhase);
      setPhaseTransitionMode("none");
      transitionTimerRefs.current = [];
    }, CONTENT_TRANSITION_MS);

    transitionTimerRefs.current = [timer];
  };

  const continueFromSilk = useCallback(() => {
    if (continueStartedRef.current || phase !== "silk" || !isSilkRevealed) {
      return;
    }

    continueStartedRef.current = true;
    onContinue();
  }, [isSilkRevealed, onContinue, phase]);

  const handleSilkKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;

    event.preventDefault();
    continueFromSilk();
  };

  useEffect(() => {
    if (phase !== "silk" || !isSilkRevealed) return;

    const timer = window.setTimeout(() => {
      continueFromSilk();
    }, SILK_AUTO_CONTINUE_MS);

    return () => window.clearTimeout(timer);
  }, [continueFromSilk, isSilkRevealed, phase]);

  useEffect(() => {
    return () => {
      clearTransitionTimers();
    };
  }, []);

  return (
    <div
      className={`wk-onboarding-intro is-${phase} has-custom-cursor${
        phaseTransitionMode !== "none" ? " is-phase-transitioning" : ""
      }${
        phaseTransitionMode === "silkShift"
          ? " is-silk-shift-transitioning"
          : ""
      }${isSilkRevealed ? " is-silk-revealed" : ""}`}
      role="presentation"
    >
      <SilkBackground
        className={`wk-onboarding-silk-canvas is-${phase}`}
        {...silkBackdrop}
      />
      <div className="wk-onboarding-intro-atmosphere" aria-hidden="true" />
      <button
        className="wk-onboarding-intro-skip"
        type="button"
        onClick={onSkip}
        aria-label={t("app.onboarding.intro.actions.skipAria")}
        data-cursor-interactive="true"
      >
        <span>{t("app.onboarding.intro.actions.skip")}</span>
        <X size={15} aria-hidden="true" />
      </button>

      <div className="wk-onboarding-intro-logo-anchor">
        <div
          className="wk-onboarding-intro-logo-shell"
          data-cursor-interactive="true"
        >
          <img
            className="wk-onboarding-intro-logo"
            src={logoSrc}
            alt="Octo"
            draggable={false}
          />
        </div>
      </div>

      <div className="wk-onboarding-intro-core">
        {phase === "opening" ? (
          <div className="wk-onboarding-intro-opening">
            <div className="wk-onboarding-intro-effect" aria-hidden="true">
              <Strands
                colors={["#F8FAFC", "#7C3AED", "#06B6D4"]}
                count={4}
                speed={0.7}
                amplitude={0.6}
                waviness={1.5}
                thickness={1}
                glow={2.25}
                taper={1.5}
                spread={1.3}
                intensity={0.35}
                saturation={1.5}
                opacity={1}
                scale={1.5}
                style={{}}
              />
            </div>

            <div className="wk-onboarding-intro-copy">
              <h1>{t("app.onboarding.intro.hero.title")}</h1>
              <p>{t("app.onboarding.intro.hero.subtitle")}</p>
            </div>
          </div>
        ) : phase === "meaning" ? (
          <div className="wk-onboarding-intro-meaning" aria-live="polite">
            <TrueFocus
              sentence={focusSentence}
              blurAmount={3}
              borderColor="#A78BFA"
              glowColor="rgba(124, 58, 237, 0.52)"
              animationDuration={0.62}
              pauseBetweenAnimations={1.65}
              enablePointerSelection
              onActiveIndexChange={setActiveMeaningIndex}
            />
            <div className="wk-onboarding-intro-meaning-copy">
              <strong>{activeMeaning.title}</strong>
              <p>
                <span>{activeMeaning.word}</span>
                {" · "}
                {activeMeaning.description}
              </p>
            </div>
          </div>
        ) : (
          <div
            className="wk-onboarding-silk-stage"
            aria-live="polite"
            aria-label={t("app.onboarding.intro.actions.enter")}
            data-cursor-interactive={isSilkRevealed ? "true" : undefined}
            onClick={continueFromSilk}
            onKeyDown={handleSilkKeyDown}
            role={isSilkRevealed ? "button" : undefined}
            tabIndex={isSilkRevealed ? 0 : -1}
          >
            {isSilkRevealed ? (
              <NarrativeRail
                items={narrativeItems}
                durations={narrativeDurations}
              />
            ) : null}
          </div>
        )}
      </div>

      <div className="wk-onboarding-intro-actions">
        <OnboardingHoverButton
          text={
            phase === "opening"
              ? t("app.onboarding.intro.actions.start")
              : t("app.onboarding.intro.actions.enter")
          }
          variant="light"
          disabled={phaseTransitionMode !== "none"}
          onClick={
            phase === "opening"
              ? () => goToPhase("meaning")
              : () => goToPhase("silk")
          }
        />
      </div>

      <OnboardingCustomCursor active />
    </div>
  );
};
