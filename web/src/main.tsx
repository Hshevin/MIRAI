import React, { ChangeEvent, FormEvent, MouseEvent, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const API = "http://127.0.0.1:8000/api/v1";

type Video = {
  id: string;
  original_name: string;
  state: string;
  width: number;
  height: number;
  duration_us: number;
  has_audio: boolean;
};
type Job = { id: string; status: string; stage: string; progress: number; error_detail?: string; result_json?: string };
type Thumbnail = { id: string; timestamp_us: number; quality_score: number };
type Person = {
  id: string;
  display_label: string;
  screen_time_us: number;
  detected_frames: number;
  appearance_count: number;
  detector_confidence: number;
  association_score: number;
  ambiguous_appearances: number;
  thumbnails: Thumbnail[];
};
type Revision = { id: string; ordinal: number; person_id: string };
type TimelineItem = {
  timestamp_us: number;
  tracklet_id: string;
  person_id: string | null;
  membership_status: string | null;
  box: [number, number, number, number];
  confidence: number;
};

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(body.detail ?? response.statusText);
  }
  return response.json();
}

function formatTime(microseconds: number) {
  const seconds = Math.round(microseconds / 1_000_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatFileSize(bytes: number) {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function App() {
  const [video, setVideo] = useState<Video | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState<Person | null>(null);
  const [revision, setRevision] = useState<Revision | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const player = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!job || !video || ["succeeded", "failed", "cancelled"].includes(job.status)) return;
    const timer = window.setInterval(async () => {
      const next = await json<Job>(`${API}/jobs/${job.id}`);
      setJob(next);
      if (next.status === "succeeded") {
        if (next.result_json) setArtifactId(JSON.parse(next.result_json).artifact_id);
        else setPeople(await json<Person[]>(`${API}/videos/${video.id}/people`));
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [job, video]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      setVideo(await json<Video>(`${API}/videos`, { method: "POST", body: form }));
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  function chooseVideo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setMessage("");
  }

  async function analyze() {
    if (!video) return;
    setJob(await json<Job>(`${API}/videos/${video.id}/analysis-jobs`, { method: "POST" }));
  }

  async function selectPerson(person: Person) {
    if (!video) return;
    const next = await json<Revision>(`${API}/videos/${video.id}/selection-revisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ person_id: person.id }),
    });
    setSelected(person);
    setRevision(next);
    setTimeline(await json<TimelineItem[]>(`${API}/videos/${video.id}/timeline`));
  }

  async function addPrompt(event: MouseEvent<HTMLVideoElement>, positive: boolean) {
    if (!revision || !player.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const coordinates = [
      (event.clientX - bounds.left) / bounds.width,
      (event.clientY - bounds.top) / bounds.height,
    ];
    const response = await json<{ revision: Revision }>(
      `${API}/selection-revisions/${revision.id}/mask-prompts`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timestamp_us: Math.round(player.current.currentTime * 1_000_000),
          kind: "point",
          positive,
          coordinates,
        }),
      },
    );
    setRevision(response.revision);
    setMessage(`${positive ? "Positive" : "Negative"} point saved in revision ${response.revision.ordinal}`);
  }

  async function override(trackletId: string, decision: "include" | "exclude") {
    if (!revision || !player.current) return;
    const center = player.current.currentTime * 1_000_000;
    const response = await json<{ revision: Revision }>(
      `${API}/selection-revisions/${revision.id}/identity-overrides`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tracklet_id: trackletId,
          start_us: Math.max(0, Math.round(center - 5_000_000)),
          end_us: Math.round(center + 5_000_000),
          decision,
        }),
      },
    );
    setRevision(response.revision);
    setMessage(`${decision} range saved in revision ${response.revision.ordinal}`);
  }

  const tracks = Array.from(new Set(timeline.map((item) => item.tracklet_id)));

  return (
    <main>
      <header>
        <span className="eyebrow">PRIMARY SUBJECT PRIVACY</span>
        <h1>Keep one person. Hide everything else.</h1>
        <p>Discover every appearance, review uncertain identity matches, then export only the approved subject.</p>
      </header>

      {!video && (
        <form className="panel upload" onSubmit={upload}>
          <span className="step">01</span>
          <div>
            <h2>Upload a video</h2>
            <p>Initial target: 1080p, up to 30 minutes.</p>
            <div className="upload-actions">
              <label className="button">
                {selectedFile ? "Choose another video" : "Choose video"}
                <input name="upload" type="file" accept="video/*" required onChange={chooseVideo} />
              </label>
              <button disabled={busy || !selectedFile}>{busy ? "Uploading and inspecting…" : "Upload video"}</button>
            </div>
            <div className={`file-selection ${selectedFile ? "selected" : ""}`} aria-live="polite">
              {selectedFile ? (
                <>
                  <span className="file-check" aria-hidden="true">✓</span>
                  <span><strong>{selectedFile.name}</strong><small>{formatFileSize(selectedFile.size)} · ready to upload</small></span>
                </>
              ) : (
                <span>No video selected</span>
              )}
            </div>
          </div>
        </form>
      )}

      {video && !selected && (
        <section className="panel">
          <div className="section-head"><span className="step">02</span><div><h2>{video.original_name}</h2><p>{video.width}×{video.height} · {formatTime(video.duration_us)} · {video.has_audio ? "audio retained" : "no audio"}</p></div></div>
          {!job && <button onClick={analyze}>Analyze people</button>}
          {job && <div className="progress"><div style={{ width: `${job.progress * 100}%` }} /><span>{job.stage} · {Math.round(job.progress * 100)}%</span></div>}
          {job?.status === "failed" && <p className="error">{job.error_detail}</p>}
          <div className="people">
            {people.map((person) => (
              <button className="person" key={person.id} onClick={() => selectPerson(person)}>
                {person.thumbnails[0] ? <img src={`${API}/thumbnails/${person.thumbnails[0].id}`} /> : <div className="placeholder" />}
                <strong>{person.display_label}</strong>
                <span>{formatTime(person.screen_time_us)} on screen · {person.appearance_count} appearances</span>
                <span>{Math.round(person.association_score * 100)} association · {person.ambiguous_appearances} uncertain</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {video && selected && revision && (
        <section className="editor">
          <div className="section-head"><span className="step">03</span><div><h2>Review {selected.display_label}</h2><p>Revision {revision.ordinal}. Left-click adds a positive mask point; right-click adds a negative point.</p></div></div>
          <video ref={player} controls src={`${API}/videos/${video.id}/proxy`} onClick={(event) => addPrompt(event, true)} onContextMenu={(event) => { event.preventDefault(); addPrompt(event, false); }} />
          <div className="track-list">
            {tracks.map((track) => <div className="track" key={track}><code>{track.slice(0, 8)}</code><span>{timeline.filter((item) => item.tracklet_id === track).length} detections</span><button onClick={() => override(track, "include")}>Include ±5s</button><button className="secondary" onClick={() => override(track, "exclude")}>Exclude ±5s</button></div>)}
          </div>
          <button onClick={async () => setJob(await json<Job>(`${API}/selection-revisions/${revision.id}/preview-jobs`, { method: "POST" }))}>Generate preview</button>
          <button onClick={async () => setJob(await json<Job>(`${API}/selection-revisions/${revision.id}/render-jobs`, { method: "POST" }))}>Process video</button>
          {artifactId && <a className="download" href={`${API}/artifacts/${artifactId}/download`}>Download validated video</a>}
        </section>
      )}
      {message && <p className="notice">{message}</p>}
      <aside>Audio is preserved and is not anonymized. Uncertain visual pixels remain hidden by default.</aside>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
