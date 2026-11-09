import { useEffect } from "react";
import { artifactUrl } from "../api";
import { kindLabel, stageLabel, statusLabel, useI18n } from "../i18n";
import { isActiveJob } from "../types";
import type { QueueJob } from "../types";
import { CloseIcon, DownloadIcon } from "./Icons";
import { ProgressBar } from "./ProgressBar";

interface QueueDrawerProps {
  open: boolean;
  jobs: QueueJob[];
  currentVideoId: string | null;
  onOpenVideo: (id: string) => Promise<void>;
  error: string | null;
  onClose: () => void;
  onCancel: (jobId: string) => void;
}

function formatClock(iso: string, locale: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(locale === "zh" ? "zh-CN" : "en", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export function QueueDrawer({
  open,
  jobs,
  error,
  onClose,
  onCancel,
  currentVideoId,
  onOpenVideo,
}: QueueDrawerProps) {
  const { t, locale } = useI18n();
  const activeCount = jobs.filter(isActiveJob).length;

  useEffect(() => {
    if (!open) {
      return;
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  return (
    <>
      <div
        className={`drawer-backdrop ${open ? "open" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`drawer ${open ? "open" : ""}`}
        aria-labelledby="queue-title"
        aria-hidden={!open}
      >
        <header className="drawer-head">
          <div>
            <h2 id="queue-title">{t("queue.title")}</h2>
            <span className="muted small">{t("queue.activeCount", { count: activeCount })}</span>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label={t("queue.close")}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>
        <div className="drawer-body">
          {error && (
            <p className="inline-error" role="alert">
              {t("queue.unavailable", { error })}
            </p>
          )}
          {!error && jobs.length === 0 && <p className="empty">{t("queue.empty")}</p>}
          <ul className="job-list">
            {jobs.map((job) => {
              const active = isActiveJob(job);
              return (
                <li key={job.id} className={`job-item status-${job.status}`}>
                  <div className="job-item-head">
                    <span className={`status-dot status-${job.status}`} aria-hidden="true" />
                    <div className="job-item-title">
                      <strong title={job.video_name}>{job.video_name}</strong>
                      <span className="muted small">
                        {kindLabel(t, job.kind)} · {formatClock(job.created_at, locale)}
                      </span>
                    </div>
                    <span className={`chip status-${job.status}`}>
                      {statusLabel(t, job.status)}
                    </span>
                  </div>
                  {active && (
                    <ProgressBar
                      value={job.progress}
                      label={
                        job.cancel_requested ? t("queue.cancelling") : stageLabel(t, job.stage)
                      }
                    />
                  )}
                  {job.error_detail && <p className="inline-error small">{job.error_detail}</p>}
                  {(active || job.artifact_id || job.video_id !== currentVideoId) && (
                    <div className="job-item-actions">
                      {job.video_id !== currentVideoId && (
                        <button
                          type="button"
                          className="btn subtle small"
                          onClick={() => void onOpenVideo(job.video_id).then(onClose)}
                        >
                          {t("queue.open")}
                        </button>
                      )}
                      {active && !job.cancel_requested && (
                        <button
                          type="button"
                          className="btn subtle small"
                          onClick={() => onCancel(job.id)}
                        >
                          {t("queue.cancel")}
                        </button>
                      )}
                      {job.artifact_id && (
                        <a className="btn subtle small" href={artifactUrl(job.artifact_id)}>
                          <DownloadIcon size={14} />
                          {t("queue.download")}
                        </a>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </aside>
    </>
  );
}
