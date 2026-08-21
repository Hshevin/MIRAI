import { useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { errorMessage, uploadVideo } from "../api";
import { formatBytes } from "../format";
import { ProgressBar } from "../components/ProgressBar";
import type { Video } from "../types";

interface UploadViewProps {
  onUploaded: (video: Video) => void;
}

export function UploadView({ onUploaded }: UploadViewProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function choose(next: File | null) {
    setFile(next);
    setError(null);
    setProgress(null);
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    choose(event.target.files?.[0] ?? null);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    choose(event.dataTransfer.files?.[0] ?? null);
  }

  async function startUpload() {
    if (!file || uploading) {
      return;
    }
    setUploading(true);
    setError(null);
    setProgress(0);
    try {
      const video = await uploadVideo(file, (loaded, total) => setProgress(loaded / total));
      onUploaded(video);
    } catch (cause) {
      setError(errorMessage(cause));
      setProgress(null);
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="panel upload-panel" aria-labelledby="upload-title">
      <h2 id="upload-title">Upload a video</h2>
      <p className="hint">
        The video is analyzed locally to find every person. Recommended: 1080p, up to 30 minutes.
      </p>
      <div
        className={`dropzone ${dragActive ? "dragging" : ""} ${file ? "has-file" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
      >
        {file ? (
          <div className="file-info">
            <strong>{file.name}</strong>
            <span>{formatBytes(file.size)} · ready to upload</span>
          </div>
        ) : (
          <div className="file-info">
            <strong>Drop a video file here</strong>
            <span>or pick one from your device</span>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          className="visually-hidden"
          aria-label="Choose video file"
          onChange={handleInput}
        />
        <button
          type="button"
          className="btn ghost"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {file ? "Choose another video" : "Choose video"}
        </button>
      </div>
      {progress !== null && (
        <ProgressBar value={progress} label={`Uploading — ${Math.round(progress * 100)}%`} />
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="actions-row">
        <button type="button" className="btn primary" disabled={!file || uploading} onClick={() => void startUpload()}>
          {uploading ? "Uploading and inspecting…" : "Upload video"}
        </button>
      </div>
    </section>
  );
}
