import React, { useEffect, useRef, useState } from "react";

type NarrativeItem = {
    title: string;
    emoji?: string;
};

type NarrativeRailProps = {
    items: NarrativeItem[];
    durations?: number[];
};

const defaultDurations = [2150, 2150, 2900];
const exitAnimationDuration = 760;
const fallbackItem = {
    title: "",
    emoji: undefined,
};

const NarrativeRail: React.FC<NarrativeRailProps> = ({ items, durations = defaultDurations }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const activeIndexRef = useRef(0);
    const exitTimerRef = useRef<number | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [previousIndex, setPreviousIndex] = useState<number | null>(null);
    const safeItems = items.length > 0 ? items : [fallbackItem];
    const activeItem = items[activeIndex] || items[0] || fallbackItem;
    const previousItem = previousIndex !== null ? safeItems[previousIndex] : null;
    const progress = items.length > 0 ? ((activeIndex + 1) / items.length) * 100 : 0;
    const paddedIndex = String(activeIndex + 1).padStart(2, "0");
    const previousPaddedIndex = previousIndex !== null ? String(previousIndex + 1).padStart(2, "0") : "";
    const paddedTotal = String(Math.max(items.length, 1)).padStart(2, "0");

    useEffect(() => {
        activeIndexRef.current = 0;
        setActiveIndex(0);
        setPreviousIndex(null);

        if (exitTimerRef.current) {
            window.clearTimeout(exitTimerRef.current);
            exitTimerRef.current = null;
        }

        const activateIndex = (nextIndex: number) => {
            const currentIndex = activeIndexRef.current;

            if (nextIndex === currentIndex) return;

            setPreviousIndex(currentIndex);
            activeIndexRef.current = nextIndex;
            setActiveIndex(nextIndex);

            if (exitTimerRef.current) {
                window.clearTimeout(exitTimerRef.current);
            }

            exitTimerRef.current = window.setTimeout(() => {
                setPreviousIndex(null);
                exitTimerRef.current = null;
            }, exitAnimationDuration);
        };

        const timers = items.slice(1).map((_, index) => {
            const delay = durations.slice(0, index + 1).reduce((sum, duration) => sum + duration, 0);
            return window.setTimeout(() => activateIndex(index + 1), delay);
        });

        return () => {
            timers.forEach((timer) => window.clearTimeout(timer));

            if (exitTimerRef.current) {
                window.clearTimeout(exitTimerRef.current);
                exitTimerRef.current = null;
            }
        };
    }, [durations, items]);

    useEffect(() => {
        const canHover = window.matchMedia("(hover: hover) and (pointer: fine)");
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

        if (!canHover.matches || reduceMotion.matches) return;

        const handleMouseMove = (event: MouseEvent) => {
            const container = containerRef.current;
            if (!container) return;

            const rect = container.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const x = Math.max(-1, Math.min(1, (event.clientX - centerX) / 220));
            const y = Math.max(-1, Math.min(1, (event.clientY - centerY) / 180));

            container.style.setProperty("--wk-narrative-parallax-x", x.toFixed(3));
            container.style.setProperty("--wk-narrative-parallax-y", y.toFixed(3));
        };

        window.addEventListener("mousemove", handleMouseMove);

        return () => window.removeEventListener("mousemove", handleMouseMove);
    }, []);

    const renderTitle = (item: NarrativeItem, phase: "active" | "exiting", index: number) => (
        <div className={`wk-onboarding-narrative-copy is-${phase}`} key={`${phase}-${index}`}>
            <h2 className={item.emoji ? "has-emoji" : undefined}>
                <span className="wk-onboarding-narrative-title">
                    {Array.from(item.title).map((char, charIndex) => (
                        <span
                            className="wk-onboarding-narrative-char"
                            key={`${index}-${char}-${charIndex}`}
                            style={{ "--char-index": charIndex } as React.CSSProperties}
                        >
                            {char === " " ? "\u00A0" : char}
                        </span>
                    ))}
                </span>
                {item.emoji ? (
                    <span className="wk-onboarding-narrative-emoji" aria-hidden="true">
                        {item.emoji}
                    </span>
                ) : null}
            </h2>
        </div>
    );

    return (
        <div className="wk-onboarding-narrative" ref={containerRef} aria-live="polite">
            <div className="wk-onboarding-narrative-index" aria-hidden="true">
                {previousIndex !== null ? (
                    <span className="is-exiting" key={`number-exiting-${previousIndex}`}>
                        {previousPaddedIndex}
                    </span>
                ) : null}
                <span className="is-active" key={`number-active-${activeIndex}`}>
                    {paddedIndex}
                </span>
            </div>

            <div className="wk-onboarding-narrative-main">
                <div className="wk-onboarding-narrative-rail">
                    <span className="wk-onboarding-narrative-count">
                        {paddedIndex} / {paddedTotal}
                    </span>
                    <div className="wk-onboarding-narrative-progress" aria-hidden="true">
                        <i style={{ height: `${progress}%` }} />
                    </div>
                </div>

                <div className="wk-onboarding-narrative-copy-stage">
                    {previousItem ? renderTitle(previousItem, "exiting", previousIndex as number) : null}
                    {renderTitle(activeItem, "active", activeIndex)}
                </div>
            </div>
        </div>
    );
};

export default NarrativeRail;
