import type { VideoSummary } from "./types";

export type ProjectStatus =
  | "analyzing"
  | "new"
  | "analysis_failed"
  | "analysis_cancelled"
  | "no_people"
  | "exporting"
  | "choose_person"
  | "exported"
  | "editing";
export type ProjectSort = "activity" | "name" | "size";

export function projectStatus(project: VideoSummary): ProjectStatus {
  if (project.active_job?.kind === "analysis") return "analyzing";
  if (!project.latest_analysis) return "new";
  if (project.latest_analysis.status === "failed") return "analysis_failed";
  if (project.latest_analysis.status === "cancelled") return "analysis_cancelled";
  if (project.person_count === 0) return "no_people";
  if (project.active_job?.kind === "preview" || project.active_job?.kind === "render")
    return "exporting";
  if (!project.latest_revision) return "choose_person";
  if (project.latest_render?.revision_id === project.latest_revision.id) return "exported";
  return "editing";
}

export function filterAndSortProjects(
  items: VideoSummary[],
  search: string,
  sort: ProjectSort,
): VideoSummary[] {
  return items
    .filter((item) => item.original_name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
    .sort((a, b) =>
      sort === "name"
        ? a.original_name.localeCompare(b.original_name)
        : sort === "size"
          ? b.storage_bytes - a.storage_bytes
          : Date.parse(b.last_activity_at) - Date.parse(a.last_activity_at),
    );
}

export function relativeActivity(iso: string, locale: string, now = Date.now()): string {
  const seconds = Math.round(
    (Date.parse(iso.endsWith("Z") || /[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`) - now) / 1000,
  );
  const formatter = new Intl.RelativeTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    numeric: "auto",
  });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  if (Math.abs(seconds) < 3600) return formatter.format(Math.round(seconds / 60), "minute");
  if (Math.abs(seconds) < 86400) return formatter.format(Math.round(seconds / 3600), "hour");
  return formatter.format(Math.round(seconds / 86400), "day");
}
