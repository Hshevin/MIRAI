import { useEffect, useId, useRef, useState } from "react";
import { artifactUrl, thumbnailUrl } from "../api";
import { formatBytes, formatPercent, formatTime } from "../format";
import { useI18n } from "../i18n";
import { projectStatus, relativeActivity } from "../projects";
import type { VideoSummary } from "../types";
import { FilmIcon } from "./Icons";

export function ProjectCard({ project, deleting, onOpen, onDelete }: {
  project: VideoSummary; deleting: boolean; onOpen: () => void; onDelete: () => void;
}) {
  const { t, locale } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const status = projectStatus(project);
  const tone = status === "analysis_failed" ? "danger" : status === "choose_person" ? "warn"
    : status === "exported" ? "clear" : ["analyzing", "exporting"].includes(status) ? "brand" : "neutral";
  useEffect(() => {
    if (!menuOpen) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const close = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen]);
  function closeMenu() { setMenuOpen(false); trigger.current?.focus(); }
  return (
    <article className={`project-card ${deleting ? "deleting" : ""}`} aria-busy={deleting}>
      <button type="button" className="project-open" onClick={onOpen} disabled={deleting} aria-label={`${t("project.open")} ${project.original_name}`}>
        <div className="project-cover">
          {project.cover_thumbnail_id ? <img src={thumbnailUrl(project.cover_thumbnail_id)} alt="" /> : <FilmIcon size={38} />}
          <span className={`chip project-status ${tone}`}>{deleting ? t("project.deleting") : t(`project.status.${status}`, {
            percent: formatPercent(project.active_job?.progress), person_label: project.latest_revision?.person_label ?? "",
            ordinal: project.latest_revision?.ordinal ?? 0,
          })}</span>
        </div>
        <div className="project-details">
          <h3 title={project.original_name}>{project.original_name}</h3>
          <p>{formatTime(project.duration_us)} · {project.width ?? "—"} × {project.height ?? "—"} · {formatBytes(project.storage_bytes)}</p>
          <p>{t("project.lastActivity", { time: relativeActivity(project.last_activity_at, locale) })}</p>
        </div>
      </button>
      <button ref={trigger} type="button" className="btn ghost project-menu-trigger" disabled={deleting}
        aria-label={`${t("project.menu")} · ${project.original_name}`} aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuId}
        onClick={() => setMenuOpen(!menuOpen)} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); setMenuOpen(true); } }}>⋯</button>
      {menuOpen && !deleting && <div id={menuId} ref={menu} role="menu" className="project-menu" onKeyDown={(event) => {
        const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
        const index = items.indexOf(document.activeElement as HTMLElement);
        if (event.key === "Escape") { event.preventDefault(); closeMenu(); }
        if (event.key === "Tab") setMenuOpen(false);
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }
      }}>
        <button type="button" role="menuitem" onClick={() => { closeMenu(); onOpen(); }}>{t("project.open")}</button>
        {project.latest_render && <a role="menuitem" href={artifactUrl(project.latest_render.artifact_id)} onClick={closeMenu}
          onKeyDown={(event) => { if (event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}>{t("project.downloadLatest")}</a>}
        <hr role="separator" />
        <button type="button" role="menuitem" className="danger-text" onClick={() => { closeMenu(); onDelete(); }}>{t("project.delete")}</button>
      </div>}
    </article>
  );
}
