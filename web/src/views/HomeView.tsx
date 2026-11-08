import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteVideo, errorMessage, listVideos } from "../api";
import { formatBytes } from "../format";
import { kindLabel, useI18n } from "../i18n";
import { filterAndSortProjects } from "../projects";
import type { ProjectSort } from "../projects";
import type { Video, VideoList, VideoSummary } from "../types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ProjectCard } from "../components/ProjectCard";
import { UploadDropzone } from "../components/UploadDropzone";
import { useToasts } from "../components/Toasts";

export function HomeView({ onUploaded, onOpenVideo, onDeleted }: {
  onUploaded: (video: Video) => void; onOpenVideo: (id: string) => Promise<void>; onDeleted: (id: string) => void;
}) {
  const { t } = useI18n();
  const { notify } = useToasts();
  const [data, setData] = useState<VideoList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ProjectSort>("activity");
  const [target, setTarget] = useState<VideoSummary | null>(null);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const deletingRef = useRef(deleting);
  deletingRef.current = deleting;
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    try {
      const next = await listVideos();
      if (!mounted.current) return;
      setData(next);
      setError(null);
      setDeleting((ids) => new Set([...ids].filter((id) => next.items.some((item) => item.id === id))));
      return next;
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause));
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    let stopped = false;
    let timer: number;
    async function poll() {
      const next = await refresh();
      if (!stopped) timer = window.setTimeout(poll, deletingRef.current.size || next?.items.some((item) => item.active_job) ? 2000 : 5000);
    }
    void poll();
    return () => { stopped = true; mounted.current = false; window.clearTimeout(timer); };
  }, [refresh]);
  const items = useMemo(() => filterAndSortProjects(data?.items ?? [], search, sort), [data, search, sort]);

  async function confirmDelete() {
    if (!target) return;
    const project = target;
    setTarget(null);
    setDeleting((ids) => new Set(ids).add(project.id));
    try {
      const result = await deleteVideo(project.id);
      onDeleted(project.id);
      if (!mounted.current) return;
      if (result.status === "deleted") {
        setData((old) => old ? { items: old.items.filter((item) => item.id !== project.id), total: old.total - 1, storage_bytes_total: Math.max(0, old.storage_bytes_total - project.storage_bytes) } : old);
        setDeleting((ids) => { const next = new Set(ids); next.delete(project.id); return next; });
        notify("success", t("project.deleted", { name: project.original_name }));
      }
      // Also refresh promptly for 202; subsequent polling follows active/deleting work.
      void refresh();
    } catch (cause) {
      if (!mounted.current) return;
      setDeleting((ids) => { const next = new Set(ids); next.delete(project.id); return next; });
      notify("error", t("project.deleteFailed", { error: errorMessage(cause) }));
    }
  }
  return (
    <section className="page home-page">
      <UploadDropzone compact={!!data?.total} onUploaded={onUploaded} />
      {error && <p className="inline-error" role="alert">{error} <button type="button" className="btn subtle small" onClick={() => void refresh()}>{t("home.retry")}</button></p>}
      {!data && !error && <div className="project-grid" aria-label={t("home.loading")} aria-busy="true">{[0, 1, 2].map((id) => <div key={id} className="project-skeleton" />)}</div>}
      {data && data.total > 0 && <section className="projects" aria-labelledby="projects-title">
        <div className="projects-heading"><h2 id="projects-title">{t("home.projects")} · {data.total}</h2><span className="muted">{t("home.storageTotal", { size: formatBytes(data.storage_bytes_total) })}</span></div>
        <div className="project-tools">
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("home.search")} aria-label={t("home.search")} />
          <select value={sort} aria-label={t("home.sort.activity")} onChange={(event) => setSort(event.target.value as ProjectSort)}>
            {(["activity", "name", "size"] as const).map((value) => <option key={value} value={value}>{t(`home.sort.${value}`)}</option>)}
          </select>
        </div>
        <div className="project-grid">{items.map((project) => <ProjectCard key={project.id} project={project} deleting={deleting.has(project.id)} onOpen={() => void onOpenVideo(project.id)} onDelete={() => setTarget(project)} />)}</div>
        {!items.length && <p className="muted">{t("home.noMatch")}</p>}
      </section>}
      <ConfirmDialog open={target !== null} title={t("delete.title", { name: target?.original_name ?? "" })}
        cancelLabel={t("delete.cancel")} confirmLabel={t("delete.confirm")} onCancel={() => setTarget(null)} onConfirm={() => void confirmDelete()}>
        <p>{t("delete.body", { revisions: target?.revision_count ?? 0, size: formatBytes(target?.storage_bytes) })}</p>
        {target?.active_job && <p className="delete-warning">{t("delete.activeJobs", { kinds: kindLabel(t, target.active_job.kind) })}</p>}
      </ConfirmDialog>
    </section>
  );
}
