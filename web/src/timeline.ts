import type { Detection } from "./types";

export type LaneKind = "selected" | "ambiguous" | "other";

/** Cell values inside a lane's column bitmap; numeric order encodes draw priority. */
export const CELL_EMPTY = 0;
export const CELL_OTHER = 1;
export const CELL_SELECTED = 2;
export const CELL_AMBIGUOUS = 3;

const KIND_TO_CELL: Record<LaneKind, number> = {
  other: CELL_OTHER,
  selected: CELL_SELECTED,
  ambiguous: CELL_AMBIGUOUS,
};

const CELL_TO_KIND: Record<number, LaneKind> = {
  [CELL_OTHER]: "other",
  [CELL_SELECTED]: "selected",
  [CELL_AMBIGUOUS]: "ambiguous",
};

export interface TimelineLane {
  trackletId: string;
  kind: LaneKind;
  firstUs: number;
  cells: Uint8Array;
}

export interface TimelineModel {
  durationUs: number;
  columns: number;
  lanes: TimelineLane[];
}

/** Classify one detection relative to the person the user is keeping. */
export function classifyDetection(
  detection: Pick<Detection, "person_id" | "membership_status">,
  selectedPersonId: string | null,
): LaneKind {
  if (detection.membership_status === "ambiguous") {
    return "ambiguous";
  }
  if (
    selectedPersonId !== null &&
    detection.person_id === selectedPersonId &&
    detection.membership_status === "confirmed"
  ) {
    return "selected";
  }
  return "other";
}

/**
 * Bucket per-frame detections into one lane per tracklet and `columns` pixel
 * columns per lane, so rendering cost depends on canvas width, not frame count.
 * When several detections land in one column, the highest-priority kind wins
 * (ambiguous > selected > other) so attention-demanding spans stay visible.
 */
export function buildTimelineModel(
  detections: Detection[],
  durationUs: number,
  columns: number,
  selectedPersonId: string | null,
): TimelineModel {
  const safeColumns = Math.max(1, Math.floor(columns));
  const laneMap = new Map<string, TimelineLane & { priority: number }>();

  for (const detection of detections) {
    let lane = laneMap.get(detection.tracklet_id);
    if (!lane) {
      lane = {
        trackletId: detection.tracklet_id,
        kind: "other",
        firstUs: detection.timestamp_us,
        cells: new Uint8Array(safeColumns),
        priority: 0,
      };
      laneMap.set(detection.tracklet_id, lane);
    }
    lane.firstUs = Math.min(lane.firstUs, detection.timestamp_us);

    const kind = classifyDetection(detection, selectedPersonId);
    const cell = KIND_TO_CELL[kind];
    const column =
      durationUs > 0
        ? Math.min(safeColumns - 1, Math.max(0, Math.floor((detection.timestamp_us / durationUs) * safeColumns)))
        : 0;
    if (cell > lane.cells[column]) {
      lane.cells[column] = cell;
    }
    if (cell > lane.priority) {
      lane.priority = cell;
      lane.kind = kind;
    }
  }

  const lanes = [...laneMap.values()]
    .map(({ priority: _priority, ...lane }) => lane)
    .sort((a, b) => a.firstUs - b.firstUs || a.trackletId.localeCompare(b.trackletId));

  return { durationUs, columns: safeColumns, lanes };
}

export interface TrackletActivity {
  trackletId: string;
  kind: LaneKind;
  count: number;
}

/** Tracklets with at least one detection inside [startUs, endUs] (inclusive). */
export function trackletsInRange(
  detections: Detection[],
  startUs: number,
  endUs: number,
  selectedPersonId: string | null,
): TrackletActivity[] {
  const map = new Map<string, { count: number; priority: number }>();
  for (const detection of detections) {
    if (detection.timestamp_us < startUs || detection.timestamp_us > endUs) {
      continue;
    }
    const cell = KIND_TO_CELL[classifyDetection(detection, selectedPersonId)];
    const entry = map.get(detection.tracklet_id) ?? { count: 0, priority: 0 };
    entry.count += 1;
    entry.priority = Math.max(entry.priority, cell);
    map.set(detection.tracklet_id, entry);
  }
  return [...map.entries()]
    .map(([trackletId, { count, priority }]) => ({
      trackletId,
      kind: CELL_TO_KIND[priority] ?? "other",
      count,
    }))
    .sort((a, b) => b.count - a.count || a.trackletId.localeCompare(b.trackletId));
}

/** Stable 1-based track numbers in order of first appearance, for human-readable labels. */
export function trackletNumbers(detections: Detection[]): Map<string, number> {
  const first = new Map<string, number>();
  for (const detection of detections) {
    const seen = first.get(detection.tracklet_id);
    if (seen === undefined || detection.timestamp_us < seen) {
      first.set(detection.tracklet_id, detection.timestamp_us);
    }
  }
  const ordered = [...first.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  return new Map(ordered.map(([trackletId], index) => [trackletId, index + 1]));
}

export interface OverrideSpan {
  tracklet_id: string;
  start_us: number;
  end_us: number;
  decision: "include" | "exclude";
}

/**
 * Whether a tracklet is effectively visible within a range: the analysis default
 * (only confirmed members of the kept person) unless a later override overlapping
 * the range says otherwise. Overrides are applied in chain order, last wins.
 */
export function effectiveVisibility(
  kind: LaneKind,
  trackletId: string,
  overrides: OverrideSpan[],
  startUs: number,
  endUs: number,
): boolean {
  let visible = kind === "selected";
  for (const override of overrides) {
    if (
      override.tracklet_id === trackletId &&
      override.start_us <= endUs &&
      override.end_us >= startUs
    ) {
      visible = override.decision === "include";
    }
  }
  return visible;
}
