import { describe, expect, it } from "vitest";
import { formatBytes, formatPercent, formatTime } from "./format";
import {
  CELL_AMBIGUOUS,
  CELL_EMPTY,
  CELL_OTHER,
  CELL_SELECTED,
  buildTimelineModel,
  classifyDetection,
  trackletsInRange,
} from "./timeline";
import type { Detection } from "./types";

describe("formatTime", () => {
  it("formats microseconds as m:ss", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(5_000_000)).toBe("0:05");
    expect(formatTime(61_500_000)).toBe("1:01");
    expect(formatTime(3_725_000_000)).toBe("62:05");
  });

  it("handles hours without padding days", () => {
    expect(formatTime(4_530_000_000)).toBe("75:30");
  });

  it("floors sub-second precision", () => {
    expect(formatTime(5_999_999)).toBe("0:05");
  });

  it("is defensive about invalid input", () => {
    expect(formatTime(null)).toBe("0:00");
    expect(formatTime(undefined)).toBe("0:00");
    expect(formatTime(-1)).toBe("0:00");
    expect(formatTime(Number.NaN)).toBe("0:00");
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe("0:00");
  });
});

describe("formatBytes", () => {
  it("formats common sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(3.25 * 1024 ** 3)).toBe("3.3 GB");
  });

  it("is defensive about invalid input", () => {
    expect(formatBytes(null)).toBe("0 B");
    expect(formatBytes(undefined)).toBe("0 B");
    expect(formatBytes(-10)).toBe("0 B");
  });
});

describe("formatPercent", () => {
  it("formats fractions", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(0.42)).toBe("42%");
    expect(formatPercent(1)).toBe("100%");
  });

  it("clamps out-of-range input", () => {
    expect(formatPercent(-0.5)).toBe("0%");
    expect(formatPercent(1.7)).toBe("100%");
  });

  it("is defensive about invalid input", () => {
    expect(formatPercent(null)).toBe("0%");
    expect(formatPercent(undefined)).toBe("0%");
    expect(formatPercent(Number.NaN)).toBe("0%");
  });
});

function detection(overrides: Partial<Detection>): Detection {
  return {
    timestamp_us: 0,
    tracklet_id: "t",
    person_id: null,
    membership_status: null,
    box: [0, 0, 1, 1],
    confidence: 0.9,
    ...overrides,
  };
}

describe("classifyDetection", () => {
  it("marks confirmed memberships of the selected person as selected", () => {
    const d = detection({ person_id: "p1", membership_status: "confirmed" });
    expect(classifyDetection(d, "p1")).toBe("selected");
  });

  it("never marks other people as selected", () => {
    const d = detection({ person_id: "p2", membership_status: "confirmed" });
    expect(classifyDetection(d, "p1")).toBe("other");
  });

  it("marks ambiguous memberships as ambiguous even for the selected person", () => {
    const d = detection({ person_id: "p1", membership_status: "ambiguous" });
    expect(classifyDetection(d, "p1")).toBe("ambiguous");
  });

  it("marks unassigned detections as other", () => {
    expect(classifyDetection(detection({}), "p1")).toBe("other");
  });
});

describe("buildTimelineModel", () => {
  it("creates one lane per tracklet sorted by first appearance", () => {
    const detections = [
      detection({ tracklet_id: "b", timestamp_us: 2_000_000 }),
      detection({ tracklet_id: "a", timestamp_us: 1_000_000 }),
      detection({ tracklet_id: "a", timestamp_us: 1_500_000 }),
    ];
    const model = buildTimelineModel(detections, 4_000_000, 100, null);
    expect(model.lanes.map((lane) => lane.trackletId)).toEqual(["a", "b"]);
  });

  it("buckets detections into the matching column", () => {
    const model = buildTimelineModel(
      [detection({ tracklet_id: "a", timestamp_us: 500_000, person_id: "p1", membership_status: "confirmed" })],
      1_000_000,
      10,
      "p1",
    );
    expect(model.lanes[0].cells[5]).toBe(CELL_SELECTED);
    expect(model.lanes[0].cells[4]).toBe(CELL_EMPTY);
  });

  it("keeps the highest-priority kind when detections share a column", () => {
    const detections = [
      detection({ tracklet_id: "a", timestamp_us: 100_000, membership_status: null }),
      detection({ tracklet_id: "a", timestamp_us: 190_000, person_id: "p1", membership_status: "ambiguous" }),
    ];
    const model = buildTimelineModel(detections, 1_000_000, 5, "p1");
    // Both detections land in column 0; ambiguous outranks other.
    expect(model.lanes[0].cells[0]).toBe(CELL_AMBIGUOUS);
    expect(model.lanes[0].kind).toBe("ambiguous");
  });

  it("survives zero duration and empty input", () => {
    expect(buildTimelineModel([], 0, 100, null).lanes).toEqual([]);
    const model = buildTimelineModel([detection({ timestamp_us: 0 })], 0, 10, null);
    expect(model.lanes[0].cells[0]).toBe(CELL_OTHER);
  });
});

describe("trackletsInRange", () => {
  const detections = [
    detection({ tracklet_id: "a", timestamp_us: 1_000_000 }),
    detection({ tracklet_id: "a", timestamp_us: 2_000_000 }),
    detection({ tracklet_id: "b", timestamp_us: 2_500_000, person_id: "p1", membership_status: "confirmed" }),
    detection({ tracklet_id: "c", timestamp_us: 9_000_000 }),
  ];

  it("lists only tracklets active inside the inclusive range", () => {
    const found = trackletsInRange(detections, 2_000_000, 2_500_000, "p1");
    // Equal counts sort by tracklet id.
    expect(found.map((item) => item.trackletId)).toEqual(["a", "b"]);
  });

  it("counts detections and classifies kinds", () => {
    const found = trackletsInRange(detections, 0, 10_000_000, "p1");
    const a = found.find((item) => item.trackletId === "a");
    const b = found.find((item) => item.trackletId === "b");
    expect(a?.count).toBe(2);
    expect(a?.kind).toBe("other");
    expect(b?.kind).toBe("selected");
  });

  it("returns an empty list for empty ranges", () => {
    expect(trackletsInRange(detections, 3_000_000, 4_000_000, "p1")).toEqual([]);
  });
});
