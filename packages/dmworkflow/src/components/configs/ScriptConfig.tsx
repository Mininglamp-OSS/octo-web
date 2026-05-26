import React, { useEffect, useRef, useState } from "react";
import { Select, TextArea } from "@douyinfe/semi-ui";
import type { FlowNodeConfig } from "../../types/flow";

interface Props {
  config: FlowNodeConfig;
  onChange: (patch: Partial<FlowNodeConfig>) => void;
}

/**
 * Lazy-load Monaco — it pulls in a multi-MB worker bundle that we don't want
 * in the FlowListPage critical path. Falls back to a textarea if it fails to
 * resolve (offline dev / CI without the package installed).
 */
function useMonaco() {
  const [comp, setComp] = useState<React.ComponentType<any> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    import("@monaco-editor/react")
      .then((m) => {
        if (!cancelled) setComp(() => m.default);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { comp, failed };
}

export default function ScriptConfig({ config, onChange }: Props) {
  const { comp: Monaco, failed } = useMonaco();
  const language = config.scriptLanguage ?? "javascript";
  const code = config.scriptCode ?? "// return value will be passed as the node output\nreturn { ok: true };";
  const lastSyncedRef = useRef(code);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%" }}>
      <div>
        <div style={{ fontSize: 12, marginBottom: 4 }}>语言</div>
        <Select
          value={language}
          style={{ width: "100%" }}
          onChange={(v) => onChange({ scriptLanguage: v as "javascript" })}
          optionList={[{ value: "javascript", label: "JavaScript" }]}
        />
      </div>
      <div style={{ flex: 1, minHeight: 240, border: "1px solid var(--semi-color-border)", borderRadius: 4 }}>
        {Monaco && !failed ? (
          <Monaco
            height="100%"
            language={language}
            value={code}
            theme="vs-dark"
            options={{ fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false }}
            onChange={(v: string | undefined) => {
              const next = v ?? "";
              if (next !== lastSyncedRef.current) {
                lastSyncedRef.current = next;
                onChange({ scriptCode: next });
              }
            }}
          />
        ) : (
          <TextArea
            value={code}
            autosize={{ minRows: 12, maxRows: 24 }}
            style={{ fontFamily: "monospace", fontSize: 12 }}
            onChange={(v) => onChange({ scriptCode: v })}
          />
        )}
      </div>
    </div>
  );
}
