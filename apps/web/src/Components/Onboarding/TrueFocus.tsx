import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./TrueFocus.css";

type TrueFocusProps = {
    sentence: string;
    separator?: string;
    blurAmount?: number;
    borderColor?: string;
    glowColor?: string;
    animationDuration?: number;
    pauseBetweenAnimations?: number;
    enablePointerSelection?: boolean;
    onActiveIndexChange?: (index: number) => void;
};

const TrueFocus: React.FC<TrueFocusProps> = ({
    sentence,
    separator = " ",
    blurAmount = 4,
    borderColor = "#A78BFA",
    glowColor = "rgba(124, 58, 237, 0.46)",
    animationDuration = 0.58,
    pauseBetweenAnimations = 1.55,
    enablePointerSelection = false,
    onActiveIndexChange,
}) => {
    const words = useMemo(() => sentence.split(separator).filter(Boolean), [sentence, separator]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const wordRefs = useRef<Array<HTMLSpanElement | null>>([]);
    const intervalRef = useRef<number | null>(null);
    const [focusRect, setFocusRect] = useState({ x: 0, y: 0, width: 0, height: 0 });

    const clearAutoAdvance = useCallback(() => {
        if (intervalRef.current !== null) {
            window.clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    }, []);

    const startAutoAdvance = useCallback(() => {
        clearAutoAdvance();

        if (!words.length) return;

        intervalRef.current = window.setInterval(() => {
            setCurrentIndex((prev) => (prev + 1) % words.length);
        }, (animationDuration + pauseBetweenAnimations) * 1000);
    }, [animationDuration, clearAutoAdvance, pauseBetweenAnimations, words.length]);

    useEffect(() => {
        startAutoAdvance();

        return clearAutoAdvance;
    }, [clearAutoAdvance, startAutoAdvance]);

    const jumpToIndex = useCallback(
        (index: number) => {
            if (!enablePointerSelection || index < 0 || index >= words.length) return;

            if (index !== currentIndex) {
                setCurrentIndex(index);
            }
            startAutoAdvance();
        },
        [currentIndex, enablePointerSelection, startAutoAdvance, words.length],
    );

    const handleWordKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLSpanElement>, index: number) => {
            if (event.key !== "Enter" && event.key !== " ") return;

            event.preventDefault();
            jumpToIndex(index);
        },
        [jumpToIndex],
    );

    useEffect(() => {
        onActiveIndexChange?.(currentIndex);
    }, [currentIndex, onActiveIndexChange]);

    useEffect(() => {
        const updateFocusRect = () => {
            const container = containerRef.current;
            const activeWord = wordRefs.current[currentIndex];

            if (!container || !activeWord) return;

            const parentRect = container.getBoundingClientRect();
            const activeRect = activeWord.getBoundingClientRect();

            setFocusRect({
                x: activeRect.left - parentRect.left,
                y: activeRect.top - parentRect.top,
                width: activeRect.width,
                height: activeRect.height,
            });
        };

        updateFocusRect();
        window.addEventListener("resize", updateFocusRect);

        return () => window.removeEventListener("resize", updateFocusRect);
    }, [currentIndex, words.length]);

    return (
        <div className="wk-true-focus" ref={containerRef}>
            {words.map((word, index) => {
                const isActive = index === currentIndex;
                const initial = word.slice(0, 1);
                const rest = word.slice(1);

                return (
                    <span
                        key={word}
                        ref={(element) => {
                            wordRefs.current[index] = element;
                        }}
                        className={`wk-true-focus-word${isActive ? " is-active" : ""}`}
                        role={enablePointerSelection ? "button" : undefined}
                        tabIndex={enablePointerSelection ? 0 : undefined}
                        data-cursor-interactive={enablePointerSelection ? "true" : undefined}
                        onClick={enablePointerSelection ? () => jumpToIndex(index) : undefined}
                        onKeyDown={enablePointerSelection ? (event) => handleWordKeyDown(event, index) : undefined}
                        style={{
                            filter: isActive ? "blur(0px)" : `blur(${blurAmount}px)`,
                            transitionDuration: `${animationDuration}s`,
                        }}
                    >
                        <span className="wk-true-focus-initial">{initial}</span>
                        <span>{rest}</span>
                    </span>
                );
            })}

            <div
                className="wk-true-focus-frame"
                style={
                    {
                        "--wk-focus-x": `${focusRect.x}px`,
                        "--wk-focus-y": `${focusRect.y}px`,
                        "--wk-focus-width": `${focusRect.width}px`,
                        "--wk-focus-height": `${focusRect.height}px`,
                        "--wk-focus-border": borderColor,
                        "--wk-focus-glow": glowColor,
                        transitionDuration: `${animationDuration}s`,
                    } as React.CSSProperties
                }
                aria-hidden="true"
            >
                <span className="wk-true-focus-corner is-top-left" />
                <span className="wk-true-focus-corner is-top-right" />
                <span className="wk-true-focus-corner is-bottom-left" />
                <span className="wk-true-focus-corner is-bottom-right" />
            </div>
        </div>
    );
};

export default TrueFocus;
