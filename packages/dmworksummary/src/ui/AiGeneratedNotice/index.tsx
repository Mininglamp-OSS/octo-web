import React from "react";
import { Sparkle } from "lucide-react";
import type { AiGeneratedNoticeProps } from "./types";
import "./index.css";

export default function AiGeneratedNotice({ text }: AiGeneratedNoticeProps) {
    return (
        <span className="summary-ai-notice">
            <Sparkle size={14} strokeWidth={1.5} aria-hidden="true" />
            <span>{text}</span>
        </span>
    );
}
