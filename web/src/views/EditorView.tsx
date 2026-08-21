import { useEffect, useMemo, useRef, useState } from "react";
import {
  addIdentityOverride,
  addMaskPrompt,
  artifactUrl,
  createRevisionJob,
  errorMessage,
  getJob,
  getTimeline,
  parseArtifactId,
  proxyUrl,
} from "../api";
import { formatTime } from "../format";
import { isActiveJob, isTerminalJob } from "../types";
import type {
  Detection,
  Job,
  MaskPromptInput,
  Person,
  QueueJob,
  RenderSettings,
  Revision,
  TimeRange,
  Video,
} from "../types";
import { trackletsInRange } from "../timeline";
import { PromptOverlay } from "../components/PromptOverlay";
import { TimelineStrip } from "../components/TimelineStrip";
import { SettingsPanel } from "../components/SettingsPanel";
import { ProgressBar } from "../components/ProgressBar";
import { useToasts } from "../components/Toasts";

interface TrackedJob {
  job: Job;
  revisionId: string;
  revisionOrdinal: number;
}

interface JobResult {
  artifactId: string;
  revisionOrdinal: number;
}

/** Polls a queued/running job once a second until it reaches a terminal status. */
function useJobPolling(
  tracked: TrackedJob | null,
  onUpdate: (job: Job) => void,
  onTerminal: (tracked: TrackedJob, job: Job) => void,
) {
  const callbacks = useRef({ onUpdate, onTerminal });
  callbacks.current = { onUpdate, onTerminal };

  useEffect(() => {
    if (!tracked || isTerminalJob(tracked.job)) {
      return;
    }
    let cancelled = false;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const next = await getJob(tracked.job.id);
          if (cancelled) {
            return;
          }
          callbacks.current.onUpdate(next);
          if (isTerminalJob(next)) {
            callbacks.current.onTerminal(tracked, next);
          }
        } catch {
          // Transient polling errors are ignored; the next tick retries.
        }
      })();
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [tracked]);
}

interface EditorViewProps {
  video: Video;
  person: Person;
  revision: Revision;
  jobs: QueueJob[];
  focusExport: boolean;
  onRevision: (revision: Revision) => void;
  onApplySettings: (settings: RenderSettings) => Promise<void>;
  onSwitchPerson: () => void;
  onNewVideo: () => void;
}

export function EditorView({
  video,
  person,
  revision,
  jobs,
  focusExport,
  onRevision,
  onApplySettings,
  onSwitchPerson,
  onNewVideo,
}: EditorViewProps) {
  const { notify } = useToasts();
  const playerRef = useRef<HTMLVideoElement>(null);
  const exportRef = useRef<HTMLElement>(null);
  const [currentTimeUs, setCurrentTimeUs] = useState(0);
  const [detections, setDetections] = useState<Detection[] | null>(null);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [range, setRange] = useState<TimeRange | null>(null);
  const [savingTracklet, setSavingTracklet] = useState<string | null>(null);
  const [previewTracked, setPreviewTracked] = useState<TrackedJob | null>(null);
  const [renderTracked, setRenderTracked] = useState<TrackedJob | null>(null);
  const [previewResult, setPreviewResult] = useState<JobResult | null>(null);
  const [renderResult, setRenderResult] = useState<JobResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetections(null);
    setTimelineError(null);
    setRange(null);
    getTimeline(video.id)
      .then((items) => {
        if (!cancelled) {
          setDetections(items);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setTimelineError(errorMessage(cause));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [video.id]);

  useEffect(() => {
    if (focusExport) {
      exportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [focusExport]);

  function handleJobTerminal(kind: "preview" | "render", tracked: TrackedJob, job: Job) {
    const label = kind === "preview" ? "Preview" : "Video processing";
    if (job.status === "succeeded") {
      const artifactId = parseArtifactId(job);
      if (artifactId) {
        const result = { artifactId, revisionOrdinal: tracked.revisionOrdinal };
        if (kind === "preview") {
          setPreviewResult(result);
        } else {
          setRenderResult(result);
        }
        notify("success", `${label} finished (revision r${tracked.revisionOrdinal}).`);
        return;
      }
    }
    if (job.status === "failed") {
      notify("error", `${label} failed: ${job.error_detail ?? "unknown error"}`);
    } else if (job.status === "cancelled") {
      notify("info", `${label} cancelled.`);
    }
  }

  useJobPolling(
    previewTracked,
    (next) => setPreviewTracked((current) => (current ? { ...current, job: next } : current)),
    (tracked, next) => handleJobTerminal("preview", tracked, next),
  );
  useJobPolling(
    renderTracked,
    (next) => setRenderTracked((current) => (current ? { ...current, job: next } : current)),
    (tracked, next) => handleJobTerminal("render", tracked, next),
  );

  const durationUs = useMemo(() => {
    if (video.duration_us && video.duration_us > 0) {
      return video.duration_us;
    }
    let max = 0;
    for (const detection of detections ?? []) {
      max = Math.max(max, detection.timestamp_us);
    }
    return max;
  }, [video.duration_us, detections]);

  const activities = useMemo(
    () =>
      range && detections
        ? trackletsInRange(detections, range.startUs, range.endUs, person.id)
        : [],
    [range, detections, person.id],
  );

  const previewActive = previewTracked !== null && isActiveJob(previewTracked.job);
  const renderActive = renderTracked !== null && isActiveJob(renderTracked.job);
  const queueBusy = jobs.some(
    (item) =>
      item.video_id === video.id &&
      (item.kind === "preview" || item.kind === "render") &&
      isActiveJob(item),
  );
  const exportBusy = previewActive || renderActive || queueBusy;

  function seek(us: number) {
    const player = playerRef.current;
    if (player) {
      player.currentTime = us / 1_000_000;
    }
    setCurrentTimeUs(us);
  }

  async function savePrompt(input: MaskPromptInput) {
    const response = await addMaskPrompt(revision.id, input);
    onRevision(response.revision);
    notify(
      "success",
      `${input.positive ? "Positive" : "Negative"} ${input.kind} saved · revision r${response.revision.ordinal}`,
    );
  }

  async function saveOverride(trackletId: string, decision: "include" | "exclude") {
    if (!range || savingTracklet) {
      return;
    }
    setSavingTracklet(trackletId);
    try {
      const response = await addIdentityOverride(revision.id, {
        tracklet_id: trackletId,
        start_us: Math.max(0, range.startUs),
        end_us: range.endUs,
        decision,
      });
      onRevision(response.revision);
      notify(
        "success",
        `${decision === "include" ? "Include" : "Exclude"} override saved · revision r${response.revision.ordinal}`,
      );
    } catch (cause) {
      notify("error", `Could not save override: ${errorMessage(cause)}`);
    } finally {
      setSavingTracklet(null);
    }
  }

  async function startJob(kind: "preview" | "render") {
    try {
      const job = await createRevisionJob(revision.id, kind);
      const tracked: TrackedJob = { job, revisionId: revision.id, revisionOrdinal: revision.ordinal };
      if (kind === "preview") {
        setPreviewTracked(tracked);
        setPreviewResult(null);
      } else {
        setRenderTracked(tracked);
        setRenderResult(null);
      }
      notify("info", kind === "preview" ? "Preview queued." : "Video processing queued.");
    } catch (cause) {
      notify("error", `Could not start ${kind}: ${errorMessage(cause)}`);
    }
  }

  return (
    <div className="editor">
      <section className="panel">
        <div className="editor-head">
          <div>
            <h2>Review and correct: {person.display_label}</h2>
            <p className="hint">
              Scrub the video, then add mask prompts. Corrections apply to the current selection
              revision.
            </p>
          </div>
          <div className="editor-head-side">
            <span className="revision-badge" title="Current selection revision">
              Revision r{revision.ordinal}
            </span>
            <button type="button" className="btn ghost small" onClick={onSwitchPerson}>
              Switch person
            </button>
            <button type="button" className="btn ghost small" onClick={onNewVideo}>
              New video
            </button>
          </div>
        </div>
        <PromptOverlay videoRef={playerRef} currentTimeUs={currentTimeUs} onPrompt={savePrompt}>
          <video
            ref={playerRef}
            controls
            preload="metadata"
            src={proxyUrl(video.id)}
            onTimeUpdate={(event) =>
              setCurrentTimeUs(Math.round(event.currentTarget.currentTime * 1_000_000))
            }
          />
        </PromptOverlay>
      </section>

      <section className="panel" aria-labelledby="timeline-title">
        <h3 id="timeline-title">Detection timeline</h3>
        {timelineError && (
          <p className="error-text" role="alert">
            Could not load the timeline: {timelineError}
          </p>
        )}
        {detections === null && !timelineError && <p className="hint">Loading timeline…</p>}
        {detections !== null && (
          <TimelineStrip
            detections={detections}
            durationUs={durationUs}
            currentTimeUs={currentTimeUs}
            selectedPersonId={person.id}
            range={range}
            onSeek={seek}
            onRangeSelect={setRange}
          />
        )}
        <p className="hint">Click the timeline to seek; drag to select a correction range.</p>
      </section>

      <div className="editor-columns">
        <section className="panel corrections" aria-labelledby="corrections-title">
          <h3 id="corrections-title">Identity corrections</h3>
          {range === null ? (
            <p className="hint">
              Drag a time range on the timeline to list the tracklets active in it, then include or
              exclude them from {person.display_label}.
            </p>
          ) : (
            <>
              <div className="range-head">
                <span>
                  Range {formatTime(range.startUs)} – {formatTime(range.endUs)}
                </span>
                <button type="button" className="btn ghost small" onClick={() => setRange(null)}>
                  Clear range
                </button>
              </div>
              {activities.length === 0 && (
                <p className="empty-state">No detections in this range.</p>
              )}
              <ul className="tracklet-list">
                {activities.map((activity) => (
                  <li key={activity.trackletId} className="tracklet-row">
                    <code title={activity.trackletId}>{activity.trackletId.slice(0, 8)}</code>
                    <span className={`tracklet-kind kind-${activity.kind}`}>
                      {activity.kind === "selected"
                        ? "selected"
                        : activity.kind === "ambiguous"
                          ? "ambiguous"
                          : "other"}
                    </span>
                    <span className="tracklet-count">
                      {activity.count} {activity.count === 1 ? "detection" : "detections"}
                    </span>
                    <span className="tracklet-actions">
                      <button
                        type="button"
                        className="btn primary small"
                        disabled={savingTracklet !== null}
                        onClick={() => void saveOverride(activity.trackletId, "include")}
                      >
                        Include
                      </button>
                      <button
                        type="button"
                        className="btn danger small"
                        disabled={savingTracklet !== null}
                        onClick={() => void saveOverride(activity.trackletId, "exclude")}
                      >
                        Exclude
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <SettingsPanel settings={revision.settings} disabled={exportBusy} onApply={onApplySettings} />
      </div>

      <section className="panel export-section" ref={exportRef} aria-labelledby="export-title">
        <h3 id="export-title">Export</h3>
        <p className="hint">
          Preview renders a short sample; processing renders the full video with only{" "}
          {person.display_label} kept clear. Jobs run against revision r{revision.ordinal}.
        </p>
        <div className="actions-row">
          <button
            type="button"
            className="btn ghost"
            disabled={exportBusy}
            onClick={() => void startJob("preview")}
          >
            {previewActive ? "Generating preview…" : "Generate preview"}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={exportBusy}
            onClick={() => void startJob("render")}
          >
            {renderActive ? "Processing video…" : "Process video"}
          </button>
        </div>
        {previewTracked && (
          <div className="job-progress" aria-live="polite">
            <span className="job-label">Preview</span>
            <ProgressBar value={previewTracked.job.progress} label={previewTracked.job.stage} />
            {previewTracked.job.status === "failed" && (
              <p className="error-text" role="alert">
                {previewTracked.job.error_detail ?? "Preview failed."}
              </p>
            )}
          </div>
        )}
        {renderTracked && (
          <div className="job-progress" aria-live="polite">
            <span className="job-label">Render</span>
            <ProgressBar value={renderTracked.job.progress} label={renderTracked.job.stage} />
            {renderTracked.job.status === "failed" && (
              <p className="error-text" role="alert">
                {renderTracked.job.error_detail ?? "Processing failed."}
              </p>
            )}
          </div>
        )}
        {previewResult && (
          <div className="result-block">
            <h4>Preview result</h4>
            {previewResult.revisionOrdinal !== revision.ordinal && (
              <p className="hint">
                Rendered from revision r{previewResult.revisionOrdinal}; current edits are revision
                r{revision.ordinal}.
              </p>
            )}
            <video
              key={previewResult.artifactId}
              className="result-video"
              controls
              src={artifactUrl(previewResult.artifactId)}
            />
          </div>
        )}
        {renderResult && (
          <div className="result-block">
            {renderResult.revisionOrdinal !== revision.ordinal && (
              <p className="hint">
                Rendered from revision r{renderResult.revisionOrdinal}; current edits are revision
                r{revision.ordinal} — process again to include them.
              </p>
            )}
            <a className="btn primary download-link" href={artifactUrl(renderResult.artifactId)}>
              Download privacy-filtered video
            </a>
          </div>
        )}
      </section>
    </div>
  );
}
