import { describe, expect, it } from "vitest";
import { filterAndSortProjects, projectStatus } from "./projects";
import type { VideoSummary } from "./types";

const analysis = { id: "a", kind: "analysis", status: "succeeded", stage: "complete", progress: 1, error_detail: null };
const revision = { id: "r", ordinal: 1, person_id: "p", person_label: "P001", created_at: "2026-01-01" };
const base: VideoSummary = {
  id: "v", original_name: "Clip.mp4", width: 640, height: 480, duration_us: 1000000,
  size_bytes: 1, has_audio: false, created_at: "2026-01-01", state: "ready",
  last_activity_at: "2026-01-01", storage_bytes: 10, cover_thumbnail_id: null, person_count: 1,
  latest_analysis: analysis, active_job: null, latest_revision: revision, revision_count: 1, latest_render: null,
};
describe("projectStatus priority", () => {
  it.each([
    [{ active_job: { ...analysis, status: "running" }, latest_analysis: null }, "analyzing"],
    [{ latest_analysis: null }, "new"],
    [{ latest_analysis: { ...analysis, status: "failed" } }, "analysis_failed"],
    [{ latest_analysis: { ...analysis, status: "cancelled" } }, "analysis_cancelled"],
    [{ person_count: 0 }, "no_people"],
    [{ active_job: { ...analysis, kind: "render" }, latest_revision: null }, "exporting"],
    [{ active_job: { ...analysis, kind: "preview" } }, "exporting"],
    [{ latest_revision: null }, "choose_person"],
    [{ latest_render: { artifact_id: "o", revision_id: "r", revision_ordinal: 1, created_at: "2026-01-01" } }, "exported"],
    [{}, "editing"],
    [{ latest_render: { artifact_id: "o", revision_id: "old", revision_ordinal: 1, created_at: "2026-01-01" }, state: "failed" }, "editing"],
  ] as [Partial<VideoSummary>, string][])("%j → %s", (patch, status) => {
    expect(projectStatus({ ...base, ...patch })).toBe(status);
  });
});
it("filters case-insensitively and sorts without mutating input", () => {
  const other = { ...base, id: "b", original_name: "Another.mp4", storage_bytes: 20, last_activity_at: "2026-02-01" };
  const items = [base, other];
  expect(filterAndSortProjects(items, "CLIP", "activity")).toEqual([base]);
  for (const sort of ["activity", "name", "size"] as const) {
    expect(filterAndSortProjects(items, "", sort)).toEqual([other, base]);
  }
  expect(items).toEqual([base, other]);
});
