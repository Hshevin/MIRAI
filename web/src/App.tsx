import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelJob,
  createSelection,
  errorMessage,
  getHealth,
  getPeople,
  getVideo,
  listJobs,
} from "./api";
import { DEFAULT_SETTINGS, isActiveJob } from "./types";
import type {
  Health,
  Person,
  QueueJob,
  RenderSettings,
  Revision,
  Step,
  Video,
} from "./types";
import { ToastContext, ToastViewport } from "./components/Toasts";
import type { Toast, ToastKind } from "./components/Toasts";
import { QueuePanel } from "./components/QueuePanel";
import { UploadView } from "./views/UploadView";
import { AnalyzeView } from "./views/AnalyzeView";
import { PeopleGallery } from "./views/PeopleGallery";
import { EditorView } from "./views/EditorView";

const STORAGE_KEY = "figure-detection.videoId";
const TOAST_TTL_MS = 4000;
const HEALTH_POLL_MS = 15_000;
const QUEUE_POLL_MS = 1000;

const STEPS: { id: Step; label: string }[] = [
  { id: "upload", label: "Upload" },
  { id: "analyze", label: "Analyze" },
  { id: "select", label: "Select" },
  { id: "review", label: "Review" },
  { id: "export", label: "Export" },
];

function HealthBadge({ health, unreachable }: { health: Health | null; unreachable: boolean }) {
  if (unreachable) {
    return (
      <span className="health-badge health-down" title="Backend API is unreachable">
        <span className="health-dot" aria-hidden="true" />
        Backend offline
      </span>
    );
  }
  if (!health) {
    return (
      <span className="health-badge health-unknown">
        <span className="health-dot" aria-hidden="true" />
        Connecting…
      </span>
    );
  }
  const ready = health.status === "ready";
  const detail = `ffmpeg: ${health.ffmpeg ? "ok" : "missing"} · ffprobe: ${health.ffprobe ? "ok" : "missing"} · CUDA: ${health.cuda ? "available" : "unavailable"}`;
  return (
    <span className={`health-badge ${ready ? "health-ready" : "health-degraded"}`} title={detail}>
      <span className="health-dot" aria-hidden="true" />
      {ready ? "Ready" : "Degraded"}
    </span>
  );
}

export function App() {
  const [step, setStep] = useState<Step>("upload");
  const [queueOpen, setQueueOpen] = useState(false);
  const [video, setVideo] = useState<Video | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [person, setPerson] = useState<Person | null>(null);
  const [revision, setRevision] = useState<Revision | null>(null);
  const [settings, setSettings] = useState<RenderSettings>(DEFAULT_SETTINGS);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthDown, setHealthDown] = useState(false);
  const [queue, setQueue] = useState<QueueJob[]>([]);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const toastTimers = useRef<number[]>([]);

  const dismissToast = useCallback((id: number) => {
    setToasts((items) => items.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (kind: ToastKind, message: string) => {
      toastId.current += 1;
      const id = toastId.current;
      setToasts((items) => [...items.slice(-4), { id, kind, message }]);
      const timer = window.setTimeout(() => dismissToast(id), TOAST_TTL_MS);
      toastTimers.current.push(timer);
    },
    [dismissToast],
  );

  const toastApi = useMemo(() => ({ notify }), [notify]);

  useEffect(
    () => () => {
      toastTimers.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const next = await getHealth();
        if (!cancelled) {
          setHealth(next);
          setHealthDown(false);
        }
      } catch {
        if (!cancelled) {
          setHealth(null);
          setHealthDown(true);
        }
      }
    }
    void poll();
    const timer = window.setInterval(poll, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const jobs = await listJobs();
        if (!cancelled) {
          setQueue(jobs);
          setQueueError(null);
        }
      } catch (cause) {
        if (!cancelled) {
          setQueueError(errorMessage(cause));
        }
      }
    }
    void poll();
    const timer = window.setInterval(poll, QUEUE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  // Reload-resume: reopen the video that was being worked on.
  useEffect(() => {
    const savedId = window.localStorage.getItem(STORAGE_KEY);
    if (!savedId) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const restored = await getVideo(savedId);
        if (cancelled) {
          return;
        }
        setVideo(restored);
        try {
          const found = await getPeople(savedId);
          if (cancelled) {
            return;
          }
          setPeople(found);
          setStep(found.length > 0 ? "select" : "analyze");
        } catch {
          if (!cancelled) {
            setStep("analyze");
          }
        }
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function resetWorkflow() {
    setVideo(null);
    setPeople([]);
    setPerson(null);
    setRevision(null);
    setSettings(DEFAULT_SETTINGS);
    setSelectingId(null);
  }

  function handleUploaded(next: Video) {
    resetWorkflow();
    setVideo(next);
    window.localStorage.setItem(STORAGE_KEY, next.id);
    setStep("analyze");
    setQueueOpen(false);
  }

  function handleAnalysisComplete(found: Person[]) {
    setPeople(found);
    setStep("select");
  }

  async function handleSelectPerson(selected: Person) {
    if (!video) {
      return;
    }
    setSelectingId(selected.id);
    try {
      const next = await createSelection(video.id, selected.id, settings);
      setPerson(selected);
      setRevision(next);
      setSettings(next.settings);
      setStep("review");
    } catch (cause) {
      notify("error", `Could not create selection: ${errorMessage(cause)}`);
    } finally {
      setSelectingId(null);
    }
  }

  async function handleApplySettings(next: RenderSettings) {
    if (!video || !person) {
      return;
    }
    try {
      const created = await createSelection(video.id, person.id, next);
      setRevision(created);
      setSettings(created.settings);
      notify("success", `Settings applied · revision r${created.ordinal}`);
    } catch (cause) {
      notify("error", `Could not apply settings: ${errorMessage(cause)}`);
      throw cause;
    }
  }

  function handleSwitchPerson() {
    setPerson(null);
    setRevision(null);
    setStep("select");
  }

  function handleNewVideo() {
    resetWorkflow();
    window.localStorage.removeItem(STORAGE_KEY);
    setStep("upload");
    setQueueOpen(false);
  }

  async function handleCancelJob(jobId: string) {
    try {
      const updated = await cancelJob(jobId);
      setQueue((items) =>
        items.map((item) =>
          item.id === updated.id
            ? {
                ...item,
                status: updated.status,
                stage: updated.stage,
                cancel_requested: updated.cancel_requested,
              }
            : item,
        ),
      );
    } catch (cause) {
      notify("error", `Could not cancel job: ${errorMessage(cause)}`);
    }
  }

  function canEnter(target: Step): boolean {
    switch (target) {
      case "upload":
        return true;
      case "analyze":
        return video !== null;
      case "select":
        return video !== null && people.length > 0;
      case "review":
      case "export":
        return revision !== null;
    }
  }

  const stepIndex = STEPS.findIndex((item) => item.id === step);
  const activeJobCount = queue.filter(isActiveJob).length;

  return (
    <ToastContext.Provider value={toastApi}>
      <div className="app">
        <header className="app-header">
          <div className="header-top">
            <div className="brand">
              <span className="brand-title">Figure Detection</span>
              <span className="brand-sub">Keep one person. Hide everything else.</span>
            </div>
            <div className="header-side">
              <HealthBadge health={health} unreachable={healthDown} />
              <button
                type="button"
                className={`btn ghost queue-toggle ${queueOpen ? "active" : ""}`}
                aria-pressed={queueOpen}
                onClick={() => setQueueOpen((open) => !open)}
              >
                Queue
                <span className="badge" aria-label={`${activeJobCount} active jobs`}>
                  {activeJobCount}
                </span>
              </button>
            </div>
          </div>
          <nav aria-label="Workflow steps">
            <ol className="stepper">
              {STEPS.map((item, index) => {
                const state =
                  index < stepIndex ? "done" : index === stepIndex ? "current" : "upcoming";
                return (
                  <li
                    key={item.id}
                    className={`stepper-item ${state}`}
                    aria-current={item.id === step ? "step" : undefined}
                  >
                    <button
                      type="button"
                      disabled={!canEnter(item.id)}
                      onClick={() => {
                        setQueueOpen(false);
                        setStep(item.id);
                      }}
                    >
                      <span className="step-number" aria-hidden="true">
                        {index + 1}
                      </span>
                      <span className="step-label">{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        </header>

        <main className="app-main">
          {queueOpen && <QueuePanel jobs={queue} error={queueError} onCancel={(id) => void handleCancelJob(id)} />}
          {!queueOpen && step === "upload" && <UploadView onUploaded={handleUploaded} />}
          {!queueOpen && step === "analyze" && video && (
            <AnalyzeView video={video} jobs={queue} onComplete={handleAnalysisComplete} />
          )}
          {!queueOpen && step === "select" && video && (
            <PeopleGallery
              video={video}
              people={people}
              selectingId={selectingId}
              onSelect={(selected) => void handleSelectPerson(selected)}
            />
          )}
          {!queueOpen &&
            (step === "review" || step === "export") &&
            video &&
            person &&
            revision && (
              <EditorView
                video={video}
                person={person}
                revision={revision}
                jobs={queue}
                focusExport={step === "export"}
                onRevision={setRevision}
                onApplySettings={handleApplySettings}
                onSwitchPerson={handleSwitchPerson}
                onNewVideo={handleNewVideo}
              />
            )}
        </main>

        <footer className="app-footer">
          Audio is preserved and is not anonymized. Uncertain visual pixels remain hidden by
          default.
        </footer>
      </div>
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}
