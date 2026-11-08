import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addIdentityOverride,
  addMaskPrompt,
  errorMessage,
  getRevisionDetail,
  getTimeline,
  proxyUrl,
  thumbnailUrl,
  updateRevisionSettings,
} from "../api";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n";
import { trackletNumbers } from "../timeline";
import type {
  Detection,
  MaskPromptInput,
  Person,
  QueueJob,
  RenderSettings,
  Revision,
  RevisionDetail,
  TimeRange,
  Video,
} from "../types";
import { PromptOverlay } from "../components/PromptOverlay";
import type { PromptTool } from "../components/PromptOverlay";
import { PlayerControls } from "../components/PlayerControls";
import { TimelineStrip } from "../components/TimelineStrip";
import { SettingsPanel } from "../components/SettingsPanel";
import { CorrectionsPanel } from "../components/CorrectionsPanel";
import { ExportPanel } from "../components/ExportPanel";
import { HistoryPanel } from "../components/HistoryPanel";
import { useToasts } from "../components/Toasts";
import { BoxIcon, EyeIcon, EyeOffIcon, PointIcon, UndoIcon, UserIcon } from "../components/Icons";

type Tab = "corrections" | "settings" | "export" | "history";

const TABS: { id: Tab; label: MessageKey }[] = [
  { id: "corrections", label: "editor.tab.corrections" },
  { id: "settings", label: "editor.tab.settings" },
  { id: "export", label: "editor.tab.export" },
  { id: "history", label: "editor.tab.history" },
];

const FINE_STEP_US = 100_000;
const COARSE_STEP_US = 1_000_000;

interface EditorViewProps {
  video: Video;
  person: Person | null;
  revision: Revision;
  jobs: QueueJob[];
  onRevision: (revision: Revision) => void;
  onStartJob: (revision: Revision, kind: "preview" | "render") => void;
  onCancelJob: (jobId: string) => void;
  onSwitchPerson: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

export function EditorView({
  video,
  person,
  revision,
  jobs,
  onRevision,
  onStartJob,
  onCancelJob,
  onSwitchPerson,
}: EditorViewProps) {
  const { t } = useI18n();
  const { notify } = useToasts();
  const playerRef = useRef<HTMLVideoElement>(null);
  const [tab, setTab] = useState<Tab>("corrections");
  const [tool, setTool] = useState<PromptTool>({ polarity: "keep", shape: "point" });
  const [currentTimeUs, setCurrentTimeUs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [playerError, setPlayerError] = useState(false);
  const [detections, setDetections] = useState<Detection[] | null>(null);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [detail, setDetail] = useState<RevisionDetail | null>(null);
  const [range, setRange] = useState<TimeRange | null>(null);
  const [savingTracklet, setSavingTracklet] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);

  const personLabel = person?.display_label ?? "—";

  useEffect(() => {
    let cancelled = false;
    setDetections(null);
    setTimelineError(null);
    getTimeline(video.id)
      .then((items) => !cancelled && setDetections(items))
      .catch((cause) => !cancelled && setTimelineError(errorMessage(cause)));
    return () => {
      cancelled = true;
    };
  }, [video.id]);

  // Keep the previous detail on screen until the next one arrives to avoid flashing.
  useEffect(() => {
    if (detail?.revision.id === revision.id) {
      return;
    }
    let cancelled = false;
    getRevisionDetail(revision.id)
      .then((next) => !cancelled && setDetail(next))
      .catch((cause) => !cancelled && notify("error", t("toast.loadFailed", { error: errorMessage(cause) })));
    return () => {
      cancelled = true;
    };
  }, [revision.id, detail?.revision.id, notify, t]);

  // Smooth playhead while playing; timeupdate alone fires only ~4×/s.
  useEffect(() => {
    if (!playing) {
      return;
    }
    let frame = 0;
    const tick = () => {
      const player = playerRef.current;
      if (player) {
        setCurrentTimeUs(Math.round(player.currentTime * 1_000_000));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const durationUs = useMemo(() => {
    if (video.duration_us && video.duration_us > 0) {
      return video.duration_us;
    }
    return (detections ?? []).reduce((max, item) => Math.max(max, item.timestamp_us), 0);
  }, [video.duration_us, detections]);

  const trackNumbers = useMemo(() => trackletNumbers(detections ?? []), [detections]);
  const ordinals = useMemo(
    () => new Map((detail?.history ?? []).map((entry) => [entry.id, entry.ordinal])),
    [detail],
  );
  const currentDetail = detail?.revision.id === revision.id ? detail : null;
  const overrides = detail?.overrides ?? [];
  const prompts = detail?.prompts ?? [];

  const seek = useCallback(
    (us: number) => {
      const clamped = Math.max(0, Math.min(durationUs || us, us));
      const player = playerRef.current;
      if (player) {
        player.currentTime = clamped / 1_000_000;
      }
      setCurrentTimeUs(clamped);
    },
    [durationUs],
  );

  const togglePlay = useCallback(() => {
    const player = playerRef.current;
    if (!player) {
      return;
    }
    if (player.paused) {
      void player.play();
    } else {
      player.pause();
    }
  }, []);

  /** Adopt a revision returned by an edit; its detail is fetched by the effect above. */
  const adopt = useCallback(
    (next: Revision, message: string) => {
      onRevision(next);
      notify("success", message);
    },
    [onRevision, notify],
  );

  const restore = useCallback(
    async (revisionId: string) => {
      setMutating(true);
      try {
        const next = await getRevisionDetail(revisionId);
        setDetail(next);
        onRevision(next.revision);
        notify("info", t("history.restored", { ordinal: next.revision.ordinal }));
      } catch (cause) {
        notify("error", t("toast.loadFailed", { error: errorMessage(cause) }));
      } finally {
        setMutating(false);
      }
    },
    [onRevision, notify, t],
  );

  const parentId = currentDetail?.revision.parent_id ?? null;
  const undo = useCallback(() => {
    if (parentId && !mutating) {
      void restore(parentId);
    }
  }, [parentId, mutating, restore]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.defaultPrevented || isTypingTarget(event.target)) {
        return;
      }
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }
      if (mod || event.altKey) {
        return;
      }
      const step = event.shiftKey ? COARSE_STEP_US : FINE_STEP_US;
      switch (event.key) {
        case " ":
          if (event.target instanceof HTMLButtonElement) {
            return;
          }
          event.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          event.preventDefault();
          seek(currentTimeUs - step);
          break;
        case "ArrowRight":
          event.preventDefault();
          seek(currentTimeUs + step);
          break;
        case "v":
        case "V":
          setTool((current) => ({ ...current, shape: "point" }));
          break;
        case "b":
        case "B":
          setTool((current) => ({ ...current, shape: "box" }));
          break;
        case "x":
        case "X":
          setTool((current) => ({ ...current, polarity: current.polarity === "keep" ? "hide" : "keep" }));
          break;
        case "Escape":
          setRange(null);
          break;
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [undo, togglePlay, seek, currentTimeUs]);

  async function savePrompt(input: MaskPromptInput) {
    try {
      const response = await addMaskPrompt(revision.id, input);
      adopt(
        response.revision,
        t("tool.promptSaved", {
          polarity: input.positive ? t("tool.keep") : t("tool.hide"),
          shape: input.kind === "point" ? t("tool.point") : t("tool.box"),
          ordinal: response.revision.ordinal,
        }),
      );
    } catch (cause) {
      notify("error", t("tool.promptFailed", { error: errorMessage(cause) }));
    }
  }

  async function saveOverride(trackletId: string, decision: "include" | "exclude") {
    if (!range || savingTracklet) {
      return;
    }
    setSavingTracklet(trackletId);
    try {
      const response = await addIdentityOverride(revision.id, {
        tracklet_id: trackletId,
        start_us: Math.max(0, Math.floor(range.startUs)),
        end_us: Math.max(Math.floor(range.startUs) + 1, Math.ceil(range.endUs)),
        decision,
      });
      adopt(
        response.revision,
        t("corr.saved", {
          track: t("timeline.track", { n: trackNumbers.get(trackletId) ?? "?" }),
          decision: decision === "include" ? t("corr.keep") : t("corr.hide"),
          ordinal: response.revision.ordinal,
        }),
      );
    } catch (cause) {
      notify("error", t("corr.failed", { error: errorMessage(cause) }));
    } finally {
      setSavingTracklet(null);
    }
  }

  async function applySettings(next: RenderSettings) {
    try {
      const created = await updateRevisionSettings(revision.id, next);
      adopt(created, t("settings.applied", { ordinal: created.ordinal }));
    } catch (cause) {
      notify("error", t("settings.failed", { error: errorMessage(cause) }));
      throw cause;
    }
  }

  const action = tool.polarity === "keep" ? t("tool.actionKeep") : t("tool.actionHide");
  const thumb = person?.thumbnails[0];

  return (
    <div className="workspace">
      <div className="stage">
        <div className="stage-bar">
          <div className="keeping">
            <span className="keeping-avatar">
              {thumb ? <img src={thumbnailUrl(thumb.id)} alt="" /> : <UserIcon size={16} />}
            </span>
            <div className="keeping-text">
              <span className="muted small">{t("editor.keeping")}</span>
              <strong>{personLabel}</strong>
            </div>
            <button type="button" className="btn ghost small" onClick={onSwitchPerson}>
              {t("editor.switchPerson")}
            </button>
          </div>

          <div className="toolbar" role="toolbar" aria-label={t("tool.polarity")}>
            <div className="segmented" role="group" aria-label={t("tool.polarity")}>
              <button
                type="button"
                className={tool.polarity === "keep" ? "active keep" : ""}
                aria-pressed={tool.polarity === "keep"}
                onClick={() => setTool((current) => ({ ...current, polarity: "keep" }))}
              >
                <EyeIcon size={15} />
                {t("tool.keep")}
              </button>
              <button
                type="button"
                className={tool.polarity === "hide" ? "active hide" : ""}
                aria-pressed={tool.polarity === "hide"}
                onClick={() => setTool((current) => ({ ...current, polarity: "hide" }))}
              >
                <EyeOffIcon size={15} />
                {t("tool.hide")}
              </button>
            </div>
            <div className="segmented" role="group" aria-label={t("tool.shape")}>
              <button
                type="button"
                className={tool.shape === "point" ? "active" : ""}
                aria-pressed={tool.shape === "point"}
                title="V"
                onClick={() => setTool((current) => ({ ...current, shape: "point" }))}
              >
                <PointIcon size={15} />
                {t("tool.point")}
                <kbd>V</kbd>
              </button>
              <button
                type="button"
                className={tool.shape === "box" ? "active" : ""}
                aria-pressed={tool.shape === "box"}
                title="B"
                onClick={() => setTool((current) => ({ ...current, shape: "box" }))}
              >
                <BoxIcon size={15} />
                {t("tool.box")}
                <kbd>B</kbd>
              </button>
            </div>
          </div>

          <div className="stage-meta">
            <span className="chip brand mono" title={currentDetail ? undefined : t("editor.loading")}>
              {t("editor.revision", { ordinal: revision.ordinal })}
            </span>
            <button
              type="button"
              className="icon-btn"
              aria-label={t("editor.undo")}
              title={t("editor.undoHint")}
              disabled={!parentId || mutating}
              onClick={undo}
            >
              <UndoIcon />
            </button>
          </div>
        </div>

        <div className={`viewer tool-${tool.polarity}`}>
          {playerError ? (
            <p className="viewer-empty">{t("player.unavailable")}</p>
          ) : (
            <>
              <video
                ref={playerRef}
                src={proxyUrl(video.id)}
                preload="auto"
                muted={muted}
                playsInline
                onTimeUpdate={(event) => setCurrentTimeUs(Math.round(event.currentTarget.currentTime * 1_000_000))}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                onError={() => setPlayerError(true)}
              />
              <PromptOverlay
                videoRef={playerRef}
                currentTimeUs={currentTimeUs}
                prompts={prompts}
                tool={tool}
                ariaLabel={t("tool.overlay")}
                onPrompt={savePrompt}
                onInvalidBox={() => notify("info", t("tool.dragBox"))}
              />
            </>
          )}
          <div className="viewer-hint">
            {tool.shape === "point" ? t("tool.hintPoint", { action }) : t("tool.hintBox", { action })}
            <span className="muted"> · {t("tool.keys")}</span>
          </div>
        </div>

        <PlayerControls
          playing={playing}
          muted={muted}
          currentTimeUs={currentTimeUs}
          durationUs={durationUs}
          onTogglePlay={togglePlay}
          onSeekBy={(delta) => seek(currentTimeUs + delta)}
          onToggleMute={() => setMuted((value) => !value)}
        />
      </div>

      <aside className="inspector">
        <div className="tabs" role="tablist">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`tab-${item.id}`}
              aria-selected={tab === item.id}
              aria-controls={`panel-${item.id}`}
              className={tab === item.id ? "active" : ""}
              onClick={() => setTab(item.id)}
            >
              {t(item.label)}
              {item.id === "corrections" && overrides.length > 0 && <span className="count">{overrides.length}</span>}
            </button>
          ))}
        </div>
        <div className="inspector-body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === "corrections" && person && (
            <CorrectionsPanel
              detections={detections}
              personId={person.id}
              range={range}
              currentTimeUs={currentTimeUs}
              durationUs={durationUs}
              overrides={overrides}
              trackNumbers={trackNumbers}
              saving={savingTracklet}
              onRange={setRange}
              onSeek={seek}
              onDecide={(trackletId, decision) => void saveOverride(trackletId, decision)}
            />
          )}
          {tab === "settings" && <SettingsPanel settings={revision.settings} onApply={applySettings} />}
          {tab === "export" && (
            <ExportPanel
              videoId={video.id}
              personLabel={personLabel}
              revision={revision}
              ordinals={ordinals}
              jobs={jobs}
              onStart={(kind) => onStartJob(revision, kind)}
              onCancel={onCancelJob}
            />
          )}
          {tab === "history" && detail && (
            <HistoryPanel
              history={detail.history}
              currentId={revision.id}
              busy={mutating}
              onRestore={(id) => void restore(id)}
            />
          )}
        </div>
      </aside>

      <section className="timeline-dock" aria-label={t("timeline.title")}>
        {timelineError && (
          <p className="inline-error" role="alert">
            {t("timeline.failed", { error: timelineError })}
          </p>
        )}
        {detections === null && !timelineError && <p className="muted small">{t("timeline.loading")}</p>}
        {detections !== null && person && (
          <TimelineStrip
            detections={detections}
            durationUs={durationUs}
            currentTimeUs={currentTimeUs}
            selectedPersonId={person.id}
            range={range}
            overrides={overrides}
            onSeek={seek}
            onRangeSelect={(next) => {
              setRange(next);
              if (next) {
                setTab("corrections");
              }
            }}
          />
        )}
      </section>
    </div>
  );
}
