import React, { useEffect, useRef, useState } from "react";
import { Dropdown } from "@douyinfe/semi-ui";
import { Check, ChevronDown, ChevronRight, Lock, Monitor } from "lucide-react";
import { t, useI18n } from "@octo/base";
import type { LoopRuntimePickerProps, RuntimeOption } from "./types";
import { ProviderIcon } from "./ProviderIcon";
import "./index.css";

let pickerSerial = 0;

/** Presentational picker. Ownership and availability are resolved by the bridge. */
export function LoopRuntimePicker({
  groups,
  scope = "mine",
  onScopeChange,
  value,
  onChange,
  disabled,
  loading,
  error,
}: LoopRuntimePickerProps) {
  useI18n();
  const [open, setOpen] = useState(false);
  const [panelId] = useState(() => `market-runtime-picker-${++pickerSerial}`);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const selectedGroup = groups.find((g) => g.items.some((r) => r.id === value));
  const selected = selectedGroup?.items.find((r) => r.id === value);
  const blocked = disabled;
  useEffect(() => {
    if (blocked) setOpen(false);
  }, [blocked]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const selectedLabel = selected
    ? `${selected.name} · ${selectedGroup!.label}`
    : t("mcp.expert.selectRuntimePlaceholder");

  const navigate = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const options: HTMLButtonElement[] = Array.from(
      panel.current?.querySelectorAll<HTMLButtonElement>(
        'button[role="option"]:not(:disabled)'
      ) ?? []
    );
    if (!options.length) return;
    event.preventDefault();
    const current = options.indexOf(
      document.activeElement as HTMLButtonElement
    );
    const index =
      event.key === "Home"
        ? 0
        : event.key === "End"
        ? options.length - 1
        : event.key === "ArrowDown"
        ? (current + 1) % options.length
        : current < 0
        ? options.length - 1
        : (current - 1 + options.length) % options.length;
    options[index].focus();
  };

  const row = (rt: RuntimeOption, machine: string) => {
    const info = [rt.version, rt.reason].filter(Boolean).join(" · ");
    const selectable = rt.selectable ?? rt.available;
    return (
      <button
        key={rt.id}
        type="button"
        role="option"
        aria-selected={rt.id === value}
        aria-disabled={!selectable}
        disabled={!selectable}
        aria-label={`${rt.name} · ${machine}${info ? ` · ${info}` : ""}`}
        title={[rt.name, machine, info].filter(Boolean).join("\n")}
        className={`wk-loop-runtime-picker__item${
          rt.id === value ? " is-selected" : ""
        }`}
        onClick={() => {
          if (selectable) {
            onChange(rt.id);
            close();
          }
        }}
      >
        <ProviderIcon provider={rt.provider} cloud={rt.cloud} />
        <span className="wk-loop-runtime-picker__identity">
          <span className="wk-loop-runtime-picker__name">{rt.name}</span>
          {info && <span className="wk-loop-runtime-picker__info">{info}</span>}
        </span>
        {rt.visibility && (
          <span className="wk-loop-runtime-picker__badge">
            {rt.visibility === "private" && <Lock aria-hidden />}
            {t(
              rt.visibility === "private"
                ? "mcp.runtimePicker.private"
                : "mcp.runtimePicker.shared"
            )}
          </span>
        )}
        <span
          className={`wk-loop-runtime-picker__dot${
            rt.available ? " is-online" : ""
          }`}
          title={t(
            rt.available
              ? "mcp.runtimePicker.available"
              : "mcp.runtimePicker.unavailableStatus"
          )}
        />
        <Check
          aria-hidden
          className={`wk-loop-runtime-picker__check${
            rt.id === value ? "" : " is-hidden"
          }`}
        />
      </button>
    );
  };

  const menu = (
    <div
      ref={panel}
      id={panelId}
      className="wk-loop-runtime-picker__panel"
      role="dialog"
      aria-label={t("mcp.expert.selectRuntime")}
      onKeyDown={navigate}
    >
      {onScopeChange ? (
        <div
          className="wk-loop-runtime-picker__scope"
          role="group"
          aria-label={t("mcp.runtimePicker.scope")}
        >
          {(["mine", "all"] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              aria-pressed={scope === filter}
              className={scope === filter ? "is-active" : ""}
              onClick={() => {
                if (filter !== scope) onScopeChange(filter);
              }}
            >
              {t(`mcp.runtimePicker.${filter}`)}
            </button>
          ))}
        </div>
      ) : null}
      <div className="wk-loop-runtime-picker__list">
        {loading ? (
          <p role="status" className="wk-loop-runtime-picker__empty">
            {t("mcp.runtimePicker.loading")}
          </p>
        ) : error ? (
          <p role="alert" className="wk-loop-runtime-picker__empty">
            {error}
          </p>
        ) : groups.length === 0 ? (
          <p className="wk-loop-runtime-picker__empty">
            {t("mcp.expert.noRuntimes")}
          </p>
        ) : (
          groups.map((group) => {
            const available = group.items.filter((r) => r.available);
            const unavailable = group.items.filter((r) => !r.available);
            return (
              <section
                key={group.key}
                className="wk-loop-runtime-picker__group"
              >
                <div
                  className="wk-loop-runtime-picker__heading"
                  title={group.label}
                >
                  <Monitor aria-hidden />
                  <span>{group.label}</span>
                </div>
                {available.length > 0 && (
                  <div role="listbox" aria-label={group.label}>
                    {available.map((rt) => row(rt, group.label))}
                  </div>
                )}
                {unavailable.length > 0 && (
                  <details className="wk-loop-runtime-picker__unavailable">
                    <summary>
                      <ChevronRight aria-hidden />
                      {t("mcp.runtimePicker.unavailable", {
                        values: { count: unavailable.length },
                      })}
                    </summary>
                    <div
                      role="listbox"
                      aria-label={`${group.label} · ${t(
                        "mcp.runtimePicker.unavailableStatus"
                      )}`}
                    >
                      {unavailable.map((rt) => row(rt, group.label))}
                    </div>
                  </details>
                )}
              </section>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <Dropdown
      trigger="custom"
      position="bottomLeft"
      visible={open && !blocked}
      onClickOutSide={() => setOpen(false)}
      render={menu}
    >
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-haspopup="dialog"
        aria-controls={open && !blocked ? panelId : undefined}
        aria-expanded={open && !blocked}
        aria-label={t("mcp.expert.selectRuntimePlaceholder")}
        aria-busy={loading}
        disabled={blocked}
        title={selectedLabel}
        className="wk-loop-runtime-picker__trigger"
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            requestAnimationFrame(() =>
              panel.current
                ?.querySelector<HTMLButtonElement>(
                  'button[role="option"]:not(:disabled)'
                )
                ?.focus()
            );
          } else if (event.key === "Escape") close();
        }}
      >
        <Monitor aria-hidden />
        <span className="wk-loop-runtime-picker__identity">
          <span className="wk-loop-runtime-picker__name">
            {loading
              ? t("mcp.runtimePicker.loading")
              : selected?.name || t("mcp.expert.selectRuntimePlaceholder")}
          </span>
          {selected && (
            <span className="wk-loop-runtime-picker__info">
              {selectedGroup!.label}
            </span>
          )}
        </span>
        <ChevronDown aria-hidden />
      </button>
    </Dropdown>
  );
}

export default LoopRuntimePicker;
