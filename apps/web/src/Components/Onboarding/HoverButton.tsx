import React from "react";

type OnboardingHoverButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
    text: string;
    icon?: React.ReactNode;
    variant?: "light" | "brand";
};

export const OnboardingHoverButton = React.forwardRef<
    HTMLButtonElement,
    OnboardingHoverButtonProps
>(function OnboardingHoverButton({
    className,
    icon,
    text,
    type = "button",
    variant = "brand",
    ...buttonProps
}, ref) {
    return (
        <button
            {...buttonProps}
            ref={ref}
            type={type}
            className={`wk-onboarding-hover-button is-${variant}${className ? ` ${className}` : ""}`}
        >
            <span className="wk-onboarding-hover-button-fill" aria-hidden="true" />
            <span className="wk-onboarding-hover-button-idle">
                <span className="wk-onboarding-hover-button-text">{text}</span>
                {icon}
            </span>
        </button>
    );
});
