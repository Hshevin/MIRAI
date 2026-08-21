import { artifactUrl } from "../api";
import { formatPercent } from "../format";
import { isActiveJob } from "../types";
import type { QueueJob } from "../types";
import { ProgressBar } from "./ProgressBar";

const STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
};

const KIND_LABELS: Record<string, string> = {
  analysis: "Analysis",
  preview: "Preview",
  render: "Render",
};

interface QueuePanelProps {
  jobs: QueueJob[];
  error: string | null;
  onCancel: (jobId: string) => void;
}

export function QueuePanel({ jobs, error, onCancel }: QueuePanelProps) {
  const activeCount = jobs.filter(isActiveJob).length;
  return (
    <section className="queue-panel" aria-labelledby="queue-title">
      <div className="panel-heading">
        <h2 id="queue-title">Processing queue</h2>
        <span className="badge">{activeCount} active</span>
      </div>
      {error && (
        <p className="error-text" role="alert">
          Queue unavailable: {error}
        </p>
      )}
      {!error && jobs.length === 0 && <p className="empty-state">No processing jobs yet.</p>}
      <div className="queue-list">
        {jobs.map((job) => (
          <article className={`queue-card status-${job.status}`} key={job.id}>
            <div className="queue-card-head">
              <div>
                <strong>{job.video_name}</strong>
                <span className="queue-kind">{KIND_LABELS[job.kind] ?? job.kind}</span>
              </div>
              <span className={`status-badge status-${job.status}`}>
                {STATUS_LABELS[job.status] ?? job.status}
              </span>
            </div>
            {isActiveJob(job) && (
              <ProgressBar value={job.progress} label={`${job.stage} — ${formatPercent(job.progress)}`} />
            )}
            <div className="queue-meta">
              <span>{job.stage}</span>
              <span>{formatPercent(job.progress)}</span>
            </div>
            {job.cancel_requested && isActiveJob(job) && (
              <p className="hint">Cancellation requested…</p>
            )}
            {job.error_detail && <p className="error-text">{job.error_detail}</p>}
            <div className="queue-actions">
              {isActiveJob(job) && (
                <button type="button" className="btn danger small" onClick={() => onCancel(job.id)}>
                  Cancel
                </button>
              )}
              {job.artifact_id && (
                <a className="btn ghost small" href={artifactUrl(job.artifact_id)}>
                  Download
                </a>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
