import { formatBytes, formatPercent, formatTime } from "../format";
import { stageLabel, useI18n } from "../i18n";
import type { MessageKey } from "../i18n";
import { isActiveJob } from "../types";
import type { QueueJob, Video } from "../types";
import { ProgressBar } from "../components/ProgressBar";
import { AlertIcon, CheckIcon, FilmIcon, RefreshIcon } from "../components/Icons";

interface AnalyzeViewProps {
  video: Video;
  /** Most recent analysis job for this video, if any. */
  job: QueueJob | null;
  /** Analysis succeeded and its results are loaded, but no person was found. */
  noPeople: boolean;
  onStart: () => void;
  onNewVideo: () => void;
}

/** Progress thresholds reported by the analysis pipeline for each phase. */
const PHASES: { id: string; label: MessageKey; until: number }[] = [
  { id: "proxy", label: "stage.proxy", until: 0.01 },
  { id: "detect_track", label: "stage.detect_track", until: 0.84 },
  { id: "group", label: "analyze.stage.group", until: 1 },
];

export function AnalyzeView({ video, job, noPeople, onStart, onNewVideo }: AnalyzeViewProps) {
  const { t } = useI18n();
  const running = job !== null && isActiveJob(job);
  const failed = job?.status === "failed";
  const cancelled = job?.status === "cancelled";
  const succeeded = job?.status === "succeeded";
  const progress = job?.progress ?? 0;
  const started = running && job.stage !== "queued";

  const meta: [MessageKey, string][] = [
    [
      "analyze.meta.resolution",
      video.width !== null && video.height !== null ? `${video.width}×${video.height}` : "—",
    ],
    ["analyze.meta.duration", formatTime(video.duration_us)],
    ["analyze.meta.size", formatBytes(video.size_bytes)],
    ["analyze.meta.codec", video.video_codec ?? "—"],
    ["analyze.meta.audio", video.has_audio ? (video.audio_codec ?? "✓") : t("analyze.meta.noAudio")],
  ];

  return (
    <section className="page page-narrow" aria-labelledby="analyze-title">
      <header className="page-head">
        <h1 id="analyze-title">{t("analyze.title")}</h1>
        <p className="lead">{t("analyze.lead")}</p>
      </header>

      <div className="card">
        <div className="file-row">
          <span className="file-icon">
            <FilmIcon size={20} />
          </span>
          <strong className="file-name" title={video.original_name}>
            {video.original_name}
          </strong>
          <button type="button" className="btn subtle small" onClick={onNewVideo}>
            {t("analyze.newVideo")}
          </button>
        </div>
        <dl className="meta-row">
          {meta.map(([key, value]) => (
            <div key={key}>
              <dt>{t(key)}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="card analyze-card" aria-live="polite">
        {(running || (succeeded && !noPeople)) && (
          <>
            <ProgressBar
              value={progress}
              label={started ? stageLabel(t, job.stage) : succeeded ? t("analyze.done") : t("analyze.waiting")}
              detail={formatPercent(progress)}
            />
            <ol className="phase-list">
              {PHASES.map((phase, index) => {
                const previousUntil = index === 0 ? 0 : PHASES[index - 1].until;
                const state = succeeded || progress >= phase.until
                  ? "done"
                  : started && progress >= previousUntil
                    ? "current"
                    : "upcoming";
                return (
                  <li key={phase.id} className={`phase ${state}`}>
                    <span className="phase-mark" aria-hidden="true">
                      {state === "done" ? <CheckIcon size={12} /> : index + 1}
                    </span>
                    {t(phase.label)}
                  </li>
                );
              })}
            </ol>
          </>
        )}

        {failed && (
          <div className="callout danger" role="alert">
            <AlertIcon />
            <div>
              <strong>{t("analyze.failed")}</strong>
              <p>{job.error_detail ?? t("common.unknownError")}</p>
            </div>
          </div>
        )}
        {cancelled && <p className="muted">{t("analyze.cancelled")}</p>}
        {noPeople && (
          <div className="callout warn">
            <AlertIcon />
            <p>{t("select.empty")}</p>
          </div>
        )}

        {(!job || failed || cancelled || noPeople) && (
          <div className="actions">
            <button type="button" className="btn primary" onClick={onStart}>
              {job ? <RefreshIcon /> : null}
              {job ? t("analyze.retry") : t("analyze.start")}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
