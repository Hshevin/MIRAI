export interface Health {
  status: string;
  ffmpeg: boolean;
  ffprobe: boolean;
  cuda: boolean;
}

export interface Video {
  id: string;
  original_name: string;
  size_bytes: number;
  state: string;
  width: number | null;
  height: number | null;
  duration_us: number | null;
  video_codec: string | null;
  audio_codec: string | null;
  has_audio: boolean;
  error_code: string | null;
  created_at: string;
}

export type JobKind = "analysis" | "preview" | "render";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface Job {
  id: string;
  video_id: string;
  kind: string;
  status: string;
  stage: string;
  progress: number;
  cancel_requested: boolean;
  error_code: string | null;
  error_detail: string | null;
  result_json: string | null;
  created_at: string;
}

export interface QueueJob extends Job {
  video_name: string;
  artifact_id: string | null;
  revision_id: string | null;
}

export interface Thumbnail {
  id: string;
  timestamp_us: number;
  quality_score: number;
}

export interface Person {
  id: string;
  display_label: string;
  screen_time_us: number;
  detected_frames: number;
  appearance_count: number;
  detector_confidence: number;
  association_score: number;
  ambiguous_appearances: number;
  thumbnails: Thumbnail[];
}

export interface Detection {
  timestamp_us: number;
  tracklet_id: string;
  person_id: string | null;
  membership_status: string | null;
  box: [number, number, number, number];
  confidence: number;
}

export interface RenderSettings {
  mosaic_block: number;
  blur_sigma: number;
  mask_margin: number;
  edge_smoothing: number;
  mask_threshold: number;
  privacy_mode: "safe" | "expert";
  expert_acknowledged: boolean;
}

export interface Revision {
  id: string;
  video_id: string;
  person_id: string;
  parent_id: string | null;
  ordinal: number;
  settings: RenderSettings;
  created_at: string;
}

export interface RevisionEditResponse {
  revision: Revision;
  edit_id: string;
}

export interface MaskPromptInput {
  timestamp_us: number;
  kind: "point" | "box";
  positive: boolean;
  coordinates: number[];
}

export interface IdentityOverrideInput {
  tracklet_id: string;
  start_us: number;
  end_us: number;
  decision: "include" | "exclude";
}

export interface RevisionOverride {
  id: string;
  revision_id: string;
  revision_ordinal: number;
  tracklet_id: string;
  start_us: number;
  end_us: number;
  decision: "include" | "exclude";
}

export interface RevisionPrompt {
  id: string;
  revision_id: string;
  revision_ordinal: number;
  timestamp_us: number;
  kind: "point" | "box";
  positive: boolean;
  coordinates: number[];
}

export type RevisionChange = "selection" | "settings" | "override" | "prompt";

export interface RevisionHistoryEntry {
  id: string;
  parent_id: string | null;
  ordinal: number;
  change: RevisionChange;
  created_at: string;
}

/** A revision plus every correction inherited along its parent chain. */
export interface RevisionDetail {
  revision: Revision;
  overrides: RevisionOverride[];
  prompts: RevisionPrompt[];
  history: RevisionHistoryEntry[];
}

export type Step = "upload" | "analyze" | "select" | "edit";

export interface TimeRange {
  startUs: number;
  endUs: number;
}

export const DEFAULT_SETTINGS: RenderSettings = {
  mosaic_block: 32,
  blur_sigma: 16,
  mask_margin: -3,
  edge_smoothing: 4,
  mask_threshold: 0.7,
  privacy_mode: "safe",
  expert_acknowledged: false,
};

/** Mirrors the backend validator: unsafe settings require acknowledged expert mode. */
export function isUnsafeSettings(settings: RenderSettings): boolean {
  return settings.mask_margin > 0 || settings.mask_threshold < 0.7;
}

export function isActiveJob(job: Pick<Job, "status">): boolean {
  return job.status === "queued" || job.status === "running";
}

export function isTerminalJob(job: Pick<Job, "status">): boolean {
  return !isActiveJob(job);
}
