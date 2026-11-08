import { useMemo } from "react";
import { formatTime } from "../format";
import { useI18n } from "../i18n";
import { effectiveVisibility, trackletsInRange } from "../timeline";
import type { Detection, RevisionOverride, TimeRange } from "../types";
import { CloseIcon, EyeIcon, EyeOffIcon } from "./Icons";

const AROUND_PLAYHEAD_US = 2_000_000;

interface CorrectionsPanelProps {
  detections: Detection[] | null;
  personId: string;
  range: TimeRange | null;
  currentTimeUs: number;
  durationUs: number;
  overrides: RevisionOverride[];
  trackNumbers: Map<string, number>;
  saving: string | null;
  onRange: (range: TimeRange | null) => void;
  onSeek: (us: number) => void;
  onDecide: (trackletId: string, decision: "include" | "exclude") => void;
}

export function CorrectionsPanel({
  detections,
  personId,
  range,
  currentTimeUs,
  durationUs,
  overrides,
  trackNumbers,
  saving,
  onRange,
  onSeek,
  onDecide,
}: CorrectionsPanelProps) {
  const { t } = useI18n();
  const activities = useMemo(
    () => (range && detections ? trackletsInRange(detections, range.startUs, range.endUs, personId) : []),
    [range, detections, personId],
  );
  const trackName = (id: string) => t("timeline.track", { n: trackNumbers.get(id) ?? "?" });

  return (
    <div className="corrections">
      <section className="panel-section">
        <h3 className="section-title">{t("corr.title")}</h3>
        {range === null ? (
          <div className="range-empty">
            <p className="muted">{t("corr.empty")}</p>
            <div className="chip-row">
              <button
                type="button"
                className="btn subtle small"
                onClick={() =>
                  onRange({
                    startUs: Math.max(0, currentTimeUs - AROUND_PLAYHEAD_US),
                    endUs: Math.min(durationUs, currentTimeUs + AROUND_PLAYHEAD_US),
                  })
                }
              >
                {t("corr.aroundPlayhead")}
              </button>
              <button
                type="button"
                className="btn subtle small"
                onClick={() => onRange({ startUs: 0, endUs: Math.max(1, durationUs) })}
              >
                {t("corr.wholeVideo")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="range-bar">
              <span className="mono">
                {t("corr.range", { start: formatTime(range.startUs), end: formatTime(range.endUs) })}
              </span>
              <button type="button" className="icon-btn small" aria-label={t("corr.clear")} title={t("corr.clear")} onClick={() => onRange(null)}>
                <CloseIcon size={14} />
              </button>
            </div>
            {activities.length === 0 && <p className="empty">{t("corr.noTracks")}</p>}
            <ul className="track-list">
              {activities.map((activity) => {
                const visible = effectiveVisibility(
                  activity.kind,
                  activity.trackletId,
                  overrides,
                  range.startUs,
                  range.endUs,
                );
                const busy = saving !== null;
                return (
                  <li key={activity.trackletId} className={`track-row ${visible ? "is-visible" : "is-hidden"}`}>
                    <span className={`track-swatch kind-${activity.kind}`} aria-hidden="true" />
                    <div className="track-info">
                      <strong title={activity.trackletId}>{trackName(activity.trackletId)}</strong>
                      <span className="muted small">
                        {t(`corr.kind.${activity.kind}`)} · {t("corr.detections", { count: activity.count })}
                      </span>
                    </div>
                    <div className="segmented small" role="group" aria-label={trackName(activity.trackletId)}>
                      <button
                        type="button"
                        className={visible ? "active keep" : ""}
                        aria-pressed={visible}
                        disabled={busy}
                        onClick={() => !visible && onDecide(activity.trackletId, "include")}
                      >
                        <EyeIcon size={14} />
                        {t("corr.keep")}
                      </button>
                      <button
                        type="button"
                        className={!visible ? "active hide" : ""}
                        aria-pressed={!visible}
                        disabled={busy}
                        onClick={() => visible && onDecide(activity.trackletId, "exclude")}
                      >
                        <EyeOffIcon size={14} />
                        {t("corr.hide")}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <section className="panel-section">
        <h3 className="section-title">{t("corr.history")}</h3>
        {overrides.length === 0 ? (
          <p className="muted small">{t("corr.historyEmpty")}</p>
        ) : (
          <ul className="override-list">
            {[...overrides].reverse().map((override) => (
              <li key={override.id}>
                <button
                  type="button"
                  className="override-item"
                  title={t("corr.jump")}
                  onClick={() => {
                    onRange({ startUs: override.start_us, endUs: override.end_us });
                    onSeek(override.start_us);
                  }}
                >
                  <span className={`chip ${override.decision === "include" ? "keep" : "hide"}`}>
                    {override.decision === "include" ? t("corr.keep") : t("corr.hide")}
                  </span>
                  <span>{trackName(override.tracklet_id)}</span>
                  <span className="mono muted small">
                    {formatTime(override.start_us)}–{formatTime(override.end_us)}
                  </span>
                  <span className="muted small">r{override.revision_ordinal}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
