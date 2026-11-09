import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelJob,
  createAnalysisJob,
  createRevisionJob,
  createSelection,
  errorMessage,
  getHealth,
  getPeople,
  getRevisionDetail,
  getVideo,
  listJobs,
  listRevisions,
} from "./api";
import { I18nProvider, kindLabel, useI18n } from "./i18n";
import type { MessageKey } from "./i18n";
import { DEFAULT_SETTINGS, isActiveJob } from "./types";
import type { Health, Person, QueueJob, Revision, Step, Video } from "./types";
import { ToastContext, ToastViewport } from "./components/Toasts";
import type { Toast, ToastKind } from "./components/Toasts";
import { QueueDrawer } from "./components/QueueDrawer";
import { CheckIcon, LayersIcon } from "./components/Icons";
import { HomeView } from "./views/HomeView";
import { AnalyzeView } from "./views/AnalyzeView";
import { PeopleGallery } from "./views/PeopleGallery";
import { EditorView } from "./views/EditorView";

const VIDEO_KEY = "mirai.videoId";
const REVISION_KEY = "mirai.revisionByVideo";
const LEGACY_REVISION_KEY = "mirai.revisionId";

function savedRevisions(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(REVISION_KEY) ?? "{}");
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).filter(([, id]) => typeof id === "string"));
    }
  } catch {
    /* Invalid saved data is discarded. */
  }
  return {};
}

function forgetVideo(id: string) {
  const mapping = savedRevisions();
  delete mapping[id];
  window.localStorage.setItem(REVISION_KEY, JSON.stringify(mapping));
  if (window.localStorage.getItem(VIDEO_KEY) === id) window.localStorage.removeItem(VIDEO_KEY);
  window.localStorage.removeItem(LEGACY_REVISION_KEY);
}
const TOAST_TTL_MS = 4500;
const HEALTH_POLL_MS = 15_000;
const QUEUE_POLL_MS = 1000;

const STEPS: { id: Step; label: MessageKey }[] = [
  { id: "upload", label: "step.upload" },
  { id: "analyze", label: "step.analyze" },
  { id: "select", label: "step.select" },
  { id: "edit", label: "step.edit" },
];

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" className="logo">
      <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="var(--bg-3)" />
      <circle cx="12" cy="9.5" r="3.6" fill="var(--clear)" />
      <path d="M5.5 19.5c1.2-3.4 3.6-5 6.5-5s5.3 1.6 6.5 5" fill="var(--clear)" />
      <rect x="15" y="15" width="3" height="3" fill="var(--masked)" />
      <rect x="18.5" y="15" width="3" height="3" fill="var(--fg-2)" />
      <rect x="18.5" y="18.5" width="3" height="3" fill="var(--masked)" />
    </svg>
  );
}

function HealthPill({ health, unreachable }: { health: Health | null; unreachable: boolean }) {
  const { t } = useI18n();
  if (unreachable) {
    return (
      <span className="health down" title={t("health.down")}>
        <span className="health-dot" />
        {t("health.down")}
      </span>
    );
  }
  if (!health) {
    return (
      <span className="health unknown">
        <span className="health-dot" />
        {t("health.connecting")}
      </span>
    );
  }
  const ready = health.status === "ready";
  const detail = t("health.detail", {
    ffmpeg: health.ffmpeg ? t("health.ok") : t("health.missing"),
    ffprobe: health.ffprobe ? t("health.ok") : t("health.missing"),
    cuda: health.cuda ? t("health.cudaOn") : t("health.cudaOff"),
  });
  return (
    <span className={`health ${ready ? "ready" : "degraded"}`} title={detail}>
      <span className="health-dot" />
      {ready ? t("health.ready") : t("health.degraded")}
    </span>
  );
}

export function App() {
  return (
    <I18nProvider>
      <Shell />
    </I18nProvider>
  );
}

function Shell() {
  const { t, locale, setLocale } = useI18n();
  const [step, setStep] = useState<Step>("upload");
  const [queueOpen, setQueueOpen] = useState(false);
  const [video, setVideo] = useState<Video | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  // Which video `people` belongs to, so "loaded, none found" differs from "not loaded yet".
  const [peopleVideoId, setPeopleVideoId] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [revision, setRevision] = useState<Revision | null>(null);
  const [creating, setCreating] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthDown, setHealthDown] = useState(false);
  const [queue, setQueue] = useState<QueueJob[]>([]);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const toastTimers = useRef<number[]>([]);
  const seenStatuses = useRef<Map<string, string> | null>(null);
  const handledAnalysis = useRef<string | null>(null);
  const openingGeneration = useRef(0);
  const resumed = useRef(false);
  const [homeVersion, setHomeVersion] = useState(0);

  const dismissToast = useCallback((id: number) => {
    setToasts((items) => items.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (kind: ToastKind, message: string) => {
      toastId.current += 1;
      const id = toastId.current;
      setToasts((items) => [...items.slice(-3), { id, kind, message }]);
      toastTimers.current.push(window.setTimeout(() => dismissToast(id), TOAST_TTL_MS));
    },
    [dismissToast],
  );
  const toastApi = useMemo(() => ({ notify }), [notify]);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  useEffect(() => () => toastTimers.current.forEach((timer) => window.clearTimeout(timer)), []);

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

  // Announce jobs that finish while the app is open, wherever the user is.
  useEffect(() => {
    const previous = seenStatuses.current;
    const next = new Map(queue.map((job) => [job.id, job.status]));
    seenStatuses.current = next;
    if (!previous) {
      return;
    }
    for (const job of queue) {
      const before = previous.get(job.id);
      if (!before || before === job.status || !["queued", "running"].includes(before)) {
        continue;
      }
      const vars = { kind: kindLabel(t, job.kind), name: job.video_name };
      if (job.status === "succeeded") {
        notify("success", t("toast.jobDone", vars));
      } else if (job.status === "failed") {
        notify(
          "error",
          t("toast.jobFailed", { ...vars, error: job.error_detail ?? t("common.unknownError") }),
        );
      }
    }
  }, [queue, notify, t]);

  const loadSelectionData = useCallback(
    async (videoId: string, generation = openingGeneration.current) => {
      const [found, existing] = await Promise.all([getPeople(videoId), listRevisions(videoId)]);
      if (generation === openingGeneration.current) {
        setPeople(found);
        setPeopleVideoId(videoId);
        setRevisions(existing);
      }
      return { found, existing };
    },
    [],
  );

  const analysisJob = useMemo(
    () =>
      video
        ? (queue.find((job) => job.video_id === video.id && job.kind === "analysis") ?? null)
        : null,
    [queue, video],
  );

  // Move on to person selection as soon as analysis succeeds.
  useEffect(() => {
    if (!video || step !== "analyze" || analysisJob?.status !== "succeeded") {
      return;
    }
    if (handledAnalysis.current === analysisJob.id) {
      return;
    }
    handledAnalysis.current = analysisJob.id;
    const generation = openingGeneration.current;
    void loadSelectionData(video.id, generation)
      .then(({ found }) => {
        if (generation === openingGeneration.current && found.length) setStep("select");
      })
      .catch((cause) => notify("error", t("toast.loadFailed", { error: errorMessage(cause) })));
  }, [analysisJob, step, video, loadSelectionData, notify, t]);

  const adoptRevision = useCallback((next: Revision) => {
    setRevision(next);
    window.localStorage.setItem(
      REVISION_KEY,
      JSON.stringify({ ...savedRevisions(), [next.video_id]: next.id }),
    );
    setRevisions((items) => (items.some((item) => item.id === next.id) ? items : [next, ...items]));
  }, []);

  const resetWorkflow = useCallback(() => {
    openingGeneration.current += 1;
    setVideo(null);
    setPeople([]);
    setPeopleVideoId(null);
    setRevisions([]);
    setRevision(null);
    handledAnalysis.current = null;
    window.localStorage.removeItem(VIDEO_KEY);
  }, []);

  const openVideo = useCallback(
    async (videoId: string) => {
      const mapping = savedRevisions();
      const legacy = window.localStorage.getItem(LEGACY_REVISION_KEY);
      const legacyVideo = window.localStorage.getItem(VIDEO_KEY);
      if (legacy && legacyVideo) {
        mapping[legacyVideo] ??= legacy;
        window.localStorage.setItem(REVISION_KEY, JSON.stringify(mapping));
      }
      window.localStorage.removeItem(LEGACY_REVISION_KEY);
      resetWorkflow();
      setStep("upload");
      const generation = openingGeneration.current;
      const current = () => generation === openingGeneration.current;
      try {
        const restored = await getVideo(videoId);
        const [{ found, existing }, jobs] = await Promise.all([
          loadSelectionData(videoId, generation),
          listJobs(),
        ]);
        if (!current()) return;
        setVideo(restored);
        setQueue(jobs);
        window.localStorage.setItem(VIDEO_KEY, videoId);
        if (
          !found.length ||
          jobs.some(
            (job) => job.video_id === videoId && job.kind === "analysis" && isActiveJob(job),
          )
        ) {
          setStep("analyze");
          return;
        }
        const candidates = [
          ...new Set([mapping[videoId], existing[0]?.id].filter((id): id is string => !!id)),
        ];
        for (const id of candidates) {
          try {
            const detail = await getRevisionDetail(id);
            if (!current()) return;
            if (detail.revision.video_id === videoId) {
              adoptRevision(detail.revision);
              setStep("edit");
              return;
            }
          } catch {
            /* A stale saved revision falls back to the newest revision. */
          }
        }
        if (current()) setStep("select");
      } catch {
        if (!current()) return;
        forgetVideo(videoId);
        resetWorkflow();
        setStep("upload");
        setHomeVersion((value) => value + 1);
        notify("error", t("project.missing"));
      }
    },
    [adoptRevision, loadSelectionData, notify, resetWorkflow, t],
  );

  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    const id = window.localStorage.getItem(VIDEO_KEY);
    if (id) void openVideo(id);
  }, [openVideo]);

  function handleDeleted(id: string) {
    forgetVideo(id);
    setQueue((jobs) => jobs.filter((job) => job.video_id !== id));
    if (video?.id === id) {
      resetWorkflow();
      setStep("upload");
    }
  }

  async function startAnalysis(target: Video) {
    try {
      const job = await createAnalysisJob(target.id);
      // Show the job immediately instead of waiting for the next queue poll.
      setQueue((items) =>
        items.some((item) => item.id === job.id)
          ? items
          : [
              { ...job, video_name: target.original_name, artifact_id: null, revision_id: null },
              ...items,
            ],
      );
    } catch (cause) {
      notify("error", errorMessage(cause));
    }
  }

  function handleUploaded(next: Video) {
    resetWorkflow();
    setVideo(next);
    window.localStorage.setItem(VIDEO_KEY, next.id);
    setStep("analyze");
    void startAnalysis(next);
  }

  async function handleConfirmPerson(selected: Person) {
    if (!video) {
      return;
    }
    setCreating(true);
    try {
      adoptRevision(await createSelection(video.id, selected.id, DEFAULT_SETTINGS));
      setStep("edit");
    } catch (cause) {
      notify("error", t("toast.selectionFailed", { error: errorMessage(cause) }));
    } finally {
      setCreating(false);
    }
  }

  function handleResume(existing: Revision) {
    adoptRevision(existing);
    setStep("edit");
  }

  async function handleStartJob(target: Revision, kind: "preview" | "render") {
    try {
      const job = await createRevisionJob(target.id, kind);
      setQueue((items) =>
        items.some((item) => item.id === job.id)
          ? items
          : [
              {
                ...job,
                video_name: video?.original_name ?? "",
                artifact_id: null,
                revision_id: target.id,
              },
              ...items,
            ],
      );
      notify("info", t("export.queued", { kind: kindLabel(t, kind) }));
    } catch (cause) {
      notify(
        "error",
        t("export.failedStart", { kind: kindLabel(t, kind), error: errorMessage(cause) }),
      );
    }
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
      notify("error", t("toast.cancelFailed", { error: errorMessage(cause) }));
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
      case "edit":
        return revision !== null;
    }
  }

  const stepIndex = STEPS.findIndex((item) => item.id === step);
  const activeJobs = queue.filter(isActiveJob);
  const person = revision ? (people.find((item) => item.id === revision.person_id) ?? null) : null;

  return (
    <ToastContext.Provider value={toastApi}>
      <div className={`app ${step === "edit" ? "is-workspace" : ""}`}>
        <header className="topbar">
          <button type="button" className="brand" onClick={() => setStep("upload")}>
            <Logo />
            <span className="brand-name">MIRAI</span>
            <span className="brand-tag">{t("app.tagline")}</span>
          </button>

          <nav aria-label="Workflow">
            <ol className="stepper">
              {STEPS.map((item, index) => {
                const state =
                  index < stepIndex ? "done" : index === stepIndex ? "current" : "upcoming";
                return (
                  <li key={item.id} className={`step ${state}`}>
                    <button
                      type="button"
                      disabled={!canEnter(item.id)}
                      aria-current={state === "current" ? "step" : undefined}
                      onClick={() => setStep(item.id)}
                    >
                      <span className="step-mark" aria-hidden="true">
                        {state === "done" ? <CheckIcon size={12} /> : index + 1}
                      </span>
                      <span className="step-label">{t(item.label)}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          <div className="topbar-side">
            <HealthPill health={health} unreachable={healthDown} />
            <button
              type="button"
              className={`btn ghost small jobs-btn ${activeJobs.length > 0 ? "busy" : ""}`}
              aria-expanded={queueOpen}
              onClick={() => setQueueOpen((open) => !open)}
            >
              <LayersIcon size={15} />
              {t("queue.button")}
              {activeJobs.length > 0 && <span className="count">{activeJobs.length}</span>}
            </button>
            <button
              type="button"
              className="btn ghost small lang-btn"
              aria-label={t("lang.switchLabel")}
              onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
            >
              {t("lang.switch")}
            </button>
          </div>
        </header>

        <main className="main">
          {step === "upload" && (
            <HomeView
              key={homeVersion}
              onUploaded={handleUploaded}
              onOpenVideo={openVideo}
              onDeleted={handleDeleted}
            />
          )}
          {step === "analyze" && video && (
            <AnalyzeView
              video={video}
              job={analysisJob}
              noPeople={
                analysisJob?.status === "succeeded" &&
                peopleVideoId === video.id &&
                people.length === 0
              }
              onStart={() => void startAnalysis(video)}
              onNewVideo={() => {
                resetWorkflow();
                setStep("upload");
              }}
            />
          )}
          {step === "select" && video && (
            <PeopleGallery
              video={video}
              people={people}
              revisions={revisions}
              creating={creating}
              onConfirm={(selected) => void handleConfirmPerson(selected)}
              onResume={handleResume}
              onReanalyze={() => {
                handledAnalysis.current = null;
                setStep("analyze");
                void startAnalysis(video);
              }}
            />
          )}
          {step === "edit" && video && revision && (
            <EditorView
              video={video}
              person={person}
              revision={revision}
              jobs={queue}
              onRevision={adoptRevision}
              onStartJob={(target, kind) => void handleStartJob(target, kind)}
              onCancelJob={(jobId) => void handleCancelJob(jobId)}
              onSwitchPerson={() => setStep("select")}
            />
          )}
        </main>

        {step !== "edit" && <footer className="footer">{t("app.footer")}</footer>}
      </div>
      <QueueDrawer
        open={queueOpen}
        jobs={queue}
        currentVideoId={video?.id ?? null}
        onOpenVideo={openVideo}
        error={queueError}
        onClose={() => setQueueOpen(false)}
        onCancel={(jobId) => void handleCancelJob(jobId)}
      />
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}
