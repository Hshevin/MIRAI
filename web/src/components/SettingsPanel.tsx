import { useEffect, useState } from "react";
import type { RenderSettings } from "../types";
import { isUnsafeSettings } from "../types";

interface NumericField {
  key: "mosaic_block" | "blur_sigma" | "mask_margin" | "edge_smoothing" | "mask_threshold";
  label: string;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
}

const FIELDS: NumericField[] = [
  { key: "mosaic_block", label: "Mosaic block", min: 4, max: 256, step: 1, format: (v) => `${Math.round(v)} px` },
  { key: "blur_sigma", label: "Blur sigma", min: 0, max: 128, step: 0.5, format: (v) => v.toFixed(1) },
  { key: "mask_margin", label: "Mask margin", min: -32, max: 32, step: 1, format: (v) => `${Math.round(v)} px` },
  { key: "edge_smoothing", label: "Edge smoothing", min: 0, max: 32, step: 1, format: (v) => `${Math.round(v)} px` },
  { key: "mask_threshold", label: "Mask threshold", min: 0.05, max: 0.99, step: 0.01, format: (v) => v.toFixed(2) },
];

interface SettingsPanelProps {
  /** Settings of the currently adopted revision (the applied snapshot). */
  settings: RenderSettings;
  disabled?: boolean;
  onApply: (settings: RenderSettings) => Promise<void>;
}

export function SettingsPanel({ settings, disabled, onApply }: SettingsPanelProps) {
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

  function updateNumber(key: NumericField["key"], value: number) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const expertValid = draft.privacy_mode === "expert" && draft.expert_acknowledged;
  const canApply = dirty && !applying && !disabled && (!unsafe || expertValid);

  async function apply() {
    setApplying(true);
    try {
      await onApply(draft);
    } finally {
      setApplying(false);
    }
  }

  return (
    <section className="panel settings-panel" aria-labelledby="settings-title">
      <h3 id="settings-title">Render settings</h3>
      <p className="hint">
        Settings are immutable per revision. Applying changes creates a new selection revision for
        the same person; prompts and overrides made earlier stay on the previous revision chain and
        do not carry over.
      </p>
      <div className="settings-grid">
        {FIELDS.map((field) => (
          <label className="slider-row" key={field.key}>
            <span className="slider-label">{field.label}</span>
            <input
              type="range"
              min={field.min}
              max={field.max}
              step={field.step}
              value={draft[field.key]}
              disabled={disabled}
              onChange={(event) => updateNumber(field.key, Number(event.target.value))}
            />
            <span className="slider-value">{field.format(draft[field.key])}</span>
          </label>
        ))}
      </div>
      <div className="privacy-mode" role="group" aria-label="Privacy mode">
        <span className="slider-label">Privacy mode</span>
        <div className="segmented">
          <button
            type="button"
            className={draft.privacy_mode === "safe" ? "active" : ""}
            aria-pressed={draft.privacy_mode === "safe"}
            disabled={disabled}
            onClick={() => setDraft((current) => ({ ...current, privacy_mode: "safe" }))}
          >
            Safe
          </button>
          <button
            type="button"
            className={draft.privacy_mode === "expert" ? "active" : ""}
            aria-pressed={draft.privacy_mode === "expert"}
            disabled={disabled}
            onClick={() => setDraft((current) => ({ ...current, privacy_mode: "expert" }))}
          >
            Expert
          </button>
        </div>
      </div>
      {unsafe && (
        <div className="expert-warning" role="alert">
          <p>
            Mask expansion (margin &gt; 0) or a lower threshold (&lt; 0.70) exposes more pixels and
            reduces privacy protection.
          </p>
          <label className="acknowledge">
            <input
              type="checkbox"
              checked={draft.expert_acknowledged}
              disabled={disabled}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  expert_acknowledged: event.target.checked,
                  privacy_mode: event.target.checked ? "expert" : current.privacy_mode,
                }))
              }
            />
            I understand and accept the reduced privacy protection.
          </label>
          {draft.privacy_mode !== "expert" && (
            <p className="hint">Switch to expert mode and tick the acknowledgement to apply these settings.</p>
          )}
        </div>
      )}
      <div className="settings-actions">
        <button type="button" className="btn primary" disabled={!canApply} onClick={() => void apply()}>
          {applying ? "Applying…" : "Apply as new revision"}
        </button>
        {dirty && !applying && <span className="hint">Unapplied changes</span>}
      </div>
    </section>
  );
}
