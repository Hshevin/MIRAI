import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n";
import type { RenderSettings } from "../types";
import { DEFAULT_SETTINGS, isUnsafeSettings } from "../types";
import { AlertIcon, InfoIcon } from "./Icons";

type NumericKey = "mosaic_block" | "blur_sigma" | "mask_margin" | "edge_smoothing" | "mask_threshold";

interface NumericField {
  key: NumericKey;
  label: MessageKey;
  help: MessageKey;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
}

const GROUPS: { title: MessageKey; fields: NumericField[] }[] = [
  {
    title: "settings.groupEffect",
    fields: [
      { key: "mosaic_block", label: "settings.mosaic", help: "settings.mosaicHelp", min: 4, max: 256, step: 1, format: (v) => `${Math.round(v)} px` },
      { key: "blur_sigma", label: "settings.blur", help: "settings.blurHelp", min: 0, max: 128, step: 0.5, format: (v) => v.toFixed(1) },
    ],
  },
  {
    title: "settings.groupMask",
    fields: [
      { key: "mask_margin", label: "settings.margin", help: "settings.marginHelp", min: -32, max: 32, step: 1, format: (v) => `${v > 0 ? "+" : ""}${Math.round(v)} px` },
      { key: "edge_smoothing", label: "settings.smoothing", help: "settings.smoothingHelp", min: 0, max: 32, step: 1, format: (v) => `${Math.round(v)} px` },
      { key: "mask_threshold", label: "settings.threshold", help: "settings.thresholdHelp", min: 0.05, max: 0.99, step: 0.01, format: (v) => v.toFixed(2) },
    ],
  },
];

interface SettingsPanelProps {
  /** Settings of the current revision (the applied snapshot). */
  settings: RenderSettings;
  onApply: (settings: RenderSettings) => Promise<void>;
}

function sameSettings(a: RenderSettings, b: RenderSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function SettingsPanel({ settings, onApply }: SettingsPanelProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<RenderSettings>(settings);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const unsafe = isUnsafeSettings(draft);

  // The acknowledgement only exists while the draft is unsafe.
  useEffect(() => {
    if (!unsafe && draft.expert_acknowledged) {
      setDraft((current) => ({ ...current, expert_acknowledged: false }));
    }
  }, [unsafe, draft.expert_acknowledged]);

  const dirty = !sameSettings(draft, settings);
  const expertValid = draft.privacy_mode === "expert" && draft.expert_acknowledged;
  const canApply = dirty && !applying && (!unsafe || expertValid);

  async function apply() {
    setApplying(true);
    try {
      await onApply(draft);
    } catch {
      // The caller reports the error; keep the draft so nothing is lost.
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="settings">
      {GROUPS.map((group) => (
        <fieldset className="settings-group" key={group.title}>
          <legend>{t(group.title)}</legend>
          {group.fields.map((field) => {
            const value = draft[field.key];
            const changed = value !== settings[field.key];
            return (
              <label className="slider" key={field.key}>
                <span className="slider-head">
                  <span className="slider-label">
                    {t(field.label)}
                    {changed && <span className="dot-changed" aria-hidden="true" />}
                  </span>
                  <span className="slider-value mono">{field.format(value)}</span>
                </span>
                <input
                  type="range"
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={value}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, [field.key]: Number(event.target.value) }))
                  }
                />
                <span className="slider-help">{t(field.help)}</span>
              </label>
            );
          })}
        </fieldset>
      ))}

      <fieldset className="settings-group">
        <legend>{t("settings.mode")}</legend>
        <div className="segmented" role="group" aria-label={t("settings.mode")}>
          {(["safe", "expert"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={draft.privacy_mode === mode ? "active" : ""}
              aria-pressed={draft.privacy_mode === mode}
              onClick={() => setDraft((current) => ({ ...current, privacy_mode: mode }))}
            >
              {t(mode === "safe" ? "settings.safe" : "settings.expert")}
            </button>
          ))}
        </div>
        {unsafe && (
          <div className="callout warn" role="alert">
            <AlertIcon />
            <div>
              <p>{t("settings.warning")}</p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.expert_acknowledged}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      expert_acknowledged: event.target.checked,
                      privacy_mode: event.target.checked ? "expert" : current.privacy_mode,
                    }))
                  }
                />
                {t("settings.ack")}
              </label>
              {!expertValid && <p className="small">{t("settings.needExpert")}</p>}
            </div>
          </div>
        )}
      </fieldset>

      <div className="sticky-actions">
        <p className="note">
          <InfoIcon size={14} />
          {dirty ? t("settings.dirty") : t("settings.note")}
        </p>
        <div className="actions">
          <button
            type="button"
            className="btn ghost small"
            disabled={sameSettings(draft, { ...DEFAULT_SETTINGS })}
            onClick={() => setDraft({ ...DEFAULT_SETTINGS })}
          >
            {t("settings.defaults")}
          </button>
          <button type="button" className="btn ghost small" disabled={!dirty} onClick={() => setDraft(settings)}>
            {t("settings.reset")}
          </button>
          <button type="button" className="btn primary small" disabled={!canApply} onClick={() => void apply()}>
            {applying ? t("settings.applying") : t("settings.apply")}
          </button>
        </div>
      </div>
    </div>
  );
}
