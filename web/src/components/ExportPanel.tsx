import { artifactUrl } from "../api";
import { stageLabel, useI18n } from "../i18n";
import { isActiveJob } from "../types";
import type { QueueJob, Revision } from "../types";
import { AlertIcon, CheckIcon, DownloadIcon, FilmIcon, RefreshIcon } from "./Icons";
import { ProgressBar } from "./ProgressBar";

interface ExportPanelProps {
  videoId: string;
  personLabel: string;
  revision: Revision;
  /** Revision ordinals by id, to explain which revision a stale result came from. */
  ordinals: Map<string, number>;
  jobs: QueueJob[];
  onStart: (kind: "preview" | "render") => void;
  onCancel: (jobId: string) => void;
}

function latestJob(jobs: QueueJob[], videoId: string, kind: string): QueueJob | null {
  // The queue is newest-first.
  return jobs.find((job) => job.video_id === videoId && job.kind === kind) ?? null;
}

export function ExportPanel({ videoId, personLabel, revision, ordinals, jobs, onStart, onCancel }: ExportPanelProps) {
  const { t } = useI18n();

  function card(kind: "preview" | "render") {
    const job = latestJob(jobs, videoId, kind);
    const active = job !== null && isActiveJob(job);
    const done = job?.status === "succeeded" && job.artifact_id;
    const stale = job !== null && job.revision_id !== revision.id;
    const staleOrdinal = job?.revision_id ? ordinals.get(job.revision_id) : undefined;
    const title = kind === "preview" ? t("export.previewTitle") : t("export.renderTitle");
    const help = kind === "preview" ? t("export.previewHelp") : t("export.renderHelp", { name: personLabel });
    const start = kind === "preview" ? t("export.previewStart") : t("export.renderStart");

    return (
      <section className={`export-card ${kind}`} aria-label={title}>
        <header>
          <h3>{title}</h3>
          {job && !active && done && (
            <span className={`chip ${stale ? "warn" : "keep"}`}>
              {stale ? t("export.stale", { ordinal: staleOrdinal ?? "?" }) : t("export.current")}
            </span>
          )}
        </header>
        <p className="muted small">{help}</p>

        {active && job && (
          <div className="export-progress">
            <ProgressBar value={job.progress} label={stageLabel(t, job.stage)} />
            {!job.cancel_requested && (
              <button type="button" className="btn ghost small" onClick={() => onCancel(job.id)}>
                {t("queue.cancel")}
              </button>
            )}
          </div>
        )}

        {job?.status === "failed" && (
          <p className="callout danger small" role="alert">
            <AlertIcon size={16} />
            <span>{job.error_detail ?? t("common.unknownError")}</span>
          </p>
        )}

        {done && job.artifact_id && kind === "preview" && (
          <video key={job.artifact_id} className="export-video" controls src={artifactUrl(job.artifact_id)} />
        )}

        <div className="actions">
          {done && job.artifact_id && kind === "render" && (
            <a className="btn primary" href={artifactUrl(job.artifact_id)}>
              <DownloadIcon />
              {t("export.download")}
            </a>
          )}
          {!active && (
            <button
              type="button"
              className={`btn ${kind === "render" && !(done && !stale) ? "primary" : "ghost"}`}
              onClick={() => onStart(kind)}
            >
              {job ? <RefreshIcon /> : kind === "render" ? <CheckIcon /> : <FilmIcon />}
              {job && !stale && done ? t("export.rerun") : start}
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <div className="export">
      {card("preview")}
      {card("render")}
    </div>
  );
}

