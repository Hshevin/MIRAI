import { useEffect, useRef, useState } from "react";
import { createAnalysisJob, errorMessage, getJob, getPeople } from "../api";
import { formatBytes, formatPercent, formatTime } from "../format";
import { isActiveJob, isTerminalJob } from "../types";
import type { Job, Person, QueueJob, Video } from "../types";
import { ProgressBar } from "../components/ProgressBar";

interface AnalyzeViewProps {
  video: Video;
  jobs: QueueJob[];
  onComplete: (people: Person[]) => void;
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="meta-item">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function AnalyzeView({ video, jobs, onComplete }: AnalyzeViewProps) {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Resume tracking an analysis job that is already active for this video
  // (e.g. after a page reload).
  useEffect(() => {
    if (job) {
      return;
    }
    const active = jobs.find(
      (item) => item.video_id === video.id && item.kind === "analysis" && isActiveJob(item),
    );
    if (active) {
      setJob(active);
    }
  }, [jobs, job, video.id]);

  useEffect(() => {
    if (!job || isTerminalJob(job)) {
      return;
    }
    let cancelled = false;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const next = await getJob(job.id);
          if (cancelled) {
            return;
          }
          setJob(next);
          if (next.status === "succeeded") {
            const people = await getPeople(video.id);
            if (!cancelled) {
              onCompleteRef.current(people);
            }
          }
        } catch (cause) {
          if (!cancelled) {
            setError(errorMessage(cause));
          }
        }
      })();
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [job, video.id]);

  async function startAnalysis() {
    setError(null);
    try {
      setJob(await createAnalysisJob(video.id));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  const running = job !== null && isActiveJob(job);
  const failed = job !== null && job.status === "failed";

  return (
    <section className="panel" aria-labelledby="analyze-title">
      <h2 id="analyze-title">Analyze people</h2>
      <dl className="meta-grid" aria-label="Video metadata">
        <MetaItem label="File" value={video.original_name} />
        <MetaItem
          label="Resolution"
          value={video.width !== null && video.height !== null ? `${video.width}×${video.height}` : "—"}
        />
        <MetaItem label="Duration" value={formatTime(video.duration_us)} />
        <MetaItem label="Size" value={formatBytes(video.size_bytes)} />
        <MetaItem label="Video codec" value={video.video_codec ?? "—"} />
        <MetaItem label="Audio" value={video.has_audio ? `${video.audio_codec ?? "yes"} (preserved, not anonymized)` : "none"} />
      </dl>

      {!job && (
        <div className="actions-row">
          <button type="button" className="btn primary" onClick={() => void startAnalysis()}>
            Analyze people
          </button>
        </div>
      )}

      {running && job && (
        <div className="job-progress" aria-live="polite">
          <ProgressBar value={job.progress} label={`${job.stage} — ${formatPercent(job.progress)}`} />
          <p className="hint">Analysis runs on the local worker; you can leave this view and come back.</p>
        </div>
      )}

      {failed && job && (
        <div className="failure-card" role="alert">
          <h3>Analysis failed</h3>
          <p className="error-text">{job.error_detail ?? "Unknown error"}</p>
          <button type="button" className="btn primary" onClick={() => void startAnalysis()}>
            Retry analysis
          </button>
        </div>
      )}

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
