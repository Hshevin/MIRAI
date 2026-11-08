import { useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { errorMessage, uploadVideo } from "../api";
import { formatBytes } from "../format";
import { useI18n } from "../i18n";
import { ProgressBar } from "../components/ProgressBar";
import { ArrowRightIcon, CpuIcon, MusicIcon, ShieldIcon, UploadIcon } from "../components/Icons";
import type { Video } from "../types";

interface UploadViewProps {
  currentVideo: Video | null;
  onUploaded: (video: Video) => void;
  onResume: () => void;
}

export function UploadView({ currentVideo, onUploaded, onResume }: UploadViewProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Choosing a file starts the upload immediately; there is no separate confirm step.
  async function start(next: File | null) {
    if (!next || file) {
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setFile(next);
    setError(null);
    setProgress(0);
    try {
      const video = await uploadVideo(next, (loaded, total) => setProgress(loaded / total), controller.signal);
      onUploaded(video);
    } catch (cause) {
      setError(controller.signal.aborted ? t("upload.cancelled") : t("upload.failed", { error: errorMessage(cause) }));
    } finally {
      abortRef.current = null;
      setFile(null);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    void start(event.target.files?.[0] ?? null);
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragActive(false);
    void start(event.dataTransfer.files?.[0] ?? null);
  }

  const uploading = file !== null;

  return (
    <section className="page page-narrow" aria-labelledby="upload-title">
      <header className="page-head center">
        <h1 id="upload-title">{t("upload.title")}</h1>
        <p className="lead">{t("upload.lead")}</p>
      </header>

      {uploading ? (
        <div className="dropzone busy">
          <UploadIcon size={28} className="dropzone-icon" />
          <strong className="dropzone-title" title={file.name}>
            {t("upload.uploading", { name: file.name })}
          </strong>
          <span className="muted small">{formatBytes(file.size)}</span>
          <div className="dropzone-progress">
            <ProgressBar value={progress} />
          </div>
          <button type="button" className="btn subtle small" onClick={() => abortRef.current?.abort()}>
            {t("upload.cancel")}
          </button>
        </div>
      ) : (
        <label
          className={`dropzone ${dragActive ? "dragging" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
        >
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            className="visually-hidden"
            onChange={handleInput}
          />
          <span className="dropzone-badge">
            <UploadIcon size={26} />
          </span>
          <strong className="dropzone-title">{t("upload.drop")}</strong>
          <span className="muted">{t("upload.or")}</span>
          <span className="muted small">{t("upload.formats")}</span>
        </label>
      )}

      {error && (
        <p className="inline-error center" role="alert">
          {error}
        </p>
      )}

      {currentVideo && !uploading && (
        <button type="button" className="resume-card" onClick={onResume}>
          <span className="muted small">{t("select.resumeTitle")}</span>
          <strong>{t("upload.resume", { name: currentVideo.original_name })}</strong>
          <ArrowRightIcon />
        </button>
      )}

      <ul className="facts">
        <li>
          <CpuIcon size={18} />
          <div>
            <strong>{t("upload.fact1Title")}</strong>
            <span>{t("upload.fact1")}</span>
          </div>
        </li>
        <li>
          <ShieldIcon size={18} />
          <div>
            <strong>{t("upload.fact2Title")}</strong>
            <span>{t("upload.fact2")}</span>
          </div>
        </li>
        <li>
          <MusicIcon size={18} />
          <div>
            <strong>{t("upload.fact3Title")}</strong>
            <span>{t("upload.fact3")}</span>
          </div>
        </li>
      </ul>
    </section>
  );
}
