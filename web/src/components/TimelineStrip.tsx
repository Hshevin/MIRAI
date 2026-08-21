import { useEffect, useMemo, useRef, useState } from "react";
import type { Detection, TimeRange } from "../types";
import {
  CELL_AMBIGUOUS,
  CELL_OTHER,
  CELL_SELECTED,
  buildTimelineModel,
  type TimelineModel,
} from "../timeline";
import { formatTime } from "../format";

const HEIGHT_PX = 90;
const SEEK_STEP_US = 5_000_000;

const CELL_COLORS: Record<number, string> = {
  [CELL_OTHER]: "#5a6672",
  [CELL_SELECTED]: "#3fb27f",
  [CELL_AMBIGUOUS]: "#d9a13b",
};

interface TimelineStripProps {
  detections: Detection[];
  durationUs: number;
  currentTimeUs: number;
  selectedPersonId: string;
  range: TimeRange | null;
  onSeek: (us: number) => void;
  onRangeSelect: (range: TimeRange | null) => void;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Lanes are drawn run-length encoded into an offscreen canvas cached per model. */
function renderLanes(model: TimelineModel, width: number, dpr: number): HTMLCanvasElement {
  const offscreen = document.createElement("canvas");
  offscreen.width = Math.max(1, Math.round(width * dpr));
  offscreen.height = Math.round(HEIGHT_PX * dpr);
  const ctx = offscreen.getContext("2d");
  if (!ctx) {
    return offscreen;
  }
  ctx.scale(dpr, dpr);
  const count = model.lanes.length;
  const laneHeight = Math.max(1, Math.min(8, Math.floor((HEIGHT_PX - 8) / count) - 1));
  const totalHeight = count * (laneHeight + 1);
  const top = Math.max(2, Math.floor((HEIGHT_PX - totalHeight) / 2));

  model.lanes.forEach((lane, laneIndex) => {
    const y = top + laneIndex * (laneHeight + 1);
    let runValue = 0;
    let runStart = 0;
    for (let column = 0; column <= model.columns; column += 1) {
      const value = column < model.columns ? lane.cells[column] : -1;
      if (value !== runValue) {
        if (runValue > 0) {
          ctx.fillStyle = CELL_COLORS[runValue];
          ctx.fillRect(runStart, y, column - runStart, laneHeight);
        }
        runValue = value;
        runStart = column;
      }
    }
  });
  return offscreen;
}

export function TimelineStrip({
  detections,
  durationUs,
  currentTimeUs,
  selectedPersonId,
  range,
  onSeek,
  onRangeSelect,
}: TimelineStripProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const laneCacheRef = useRef<{ model: TimelineModel; width: number; canvas: HTMLCanvasElement } | null>(null);
  const [width, setWidth] = useState(0);
  const [dragStartX, setDragStartX] = useState<number | null>(null);
  const [liveRange, setLiveRange] = useState<TimeRange | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(Math.max(0, Math.floor(entry.contentRect.width)));
      }
    });
    observer.observe(container);
    setWidth(Math.max(0, Math.floor(container.getBoundingClientRect().width)));
    return () => observer.disconnect();
  }, []);

  const model = useMemo(
    () => buildTimelineModel(detections, durationUs, Math.max(1, width), selectedPersonId),
    [detections, durationUs, width, selectedPersonId],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.round(HEIGHT_PX * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, HEIGHT_PX);

    if (model.lanes.length === 0 || durationUs <= 0) {
      ctx.fillStyle = "#96a3ab";
      ctx.font = "12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        durationUs <= 0 ? "No duration information" : "No detections on the timeline",
        width / 2,
        HEIGHT_PX / 2,
      );
      return;
    }

    let cache = laneCacheRef.current;
    if (!cache || cache.model !== model || cache.width !== width) {
      cache = { model, width, canvas: renderLanes(model, width, dpr) };
      laneCacheRef.current = cache;
    }
    ctx.drawImage(cache.canvas, 0, 0, width, HEIGHT_PX);

    const shownRange = liveRange ?? range;
    if (shownRange) {
      const x1 = clamp01(shownRange.startUs / durationUs) * width;
      const x2 = clamp01(shownRange.endUs / durationUs) * width;
      ctx.fillStyle = "rgba(63, 178, 127, 0.16)";
      ctx.fillRect(x1, 0, Math.max(1, x2 - x1), HEIGHT_PX);
      ctx.fillStyle = "#3fb27f";
      ctx.fillRect(x1, 0, 1, HEIGHT_PX);
      ctx.fillRect(x2, 0, 1, HEIGHT_PX);
    }

    const playheadX = clamp01(currentTimeUs / durationUs) * width;
    ctx.fillStyle = "#e6ebee";
    ctx.fillRect(playheadX - 1, 0, 2, HEIGHT_PX);
  }, [model, width, durationUs, currentTimeUs, range, liveRange]);

  function xToUs(x: number): number {
    if (durationUs <= 0 || width === 0) {
      return 0;
    }
    return clamp01(x / width) * durationUs;
  }

  function localX(event: { clientX: number }): number {
    const canvas = canvasRef.current;
    if (!canvas) {
      return 0;
    }
    const bounds = canvas.getBoundingClientRect();
    return event.clientX - bounds.left;
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragStartX(localX(event));
    setLiveRange(null);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (dragStartX === null) {
      return;
    }
    const x = localX(event);
    if (Math.abs(x - dragStartX) < 4 && !liveRange) {
      return;
    }
    const startUs = xToUs(Math.min(dragStartX, x));
    const endUs = xToUs(Math.max(dragStartX, x));
    setLiveRange({ startUs, endUs });
  }

  function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    const x = localX(event);
    const startX = dragStartX;
    setDragStartX(null);
    if (liveRange) {
      const startUs = Math.max(0, Math.floor(Math.min(liveRange.startUs, liveRange.endUs)));
      let endUs = Math.ceil(Math.max(liveRange.startUs, liveRange.endUs));
      if (endUs <= startUs) {
        endUs = startUs + 1;
      }
      setLiveRange(null);
      onRangeSelect({ startUs, endUs });
      return;
    }
    setLiveRange(null);
    if (startX !== null) {
      onSeek(Math.round(xToUs(x)));
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLCanvasElement>) {
    if (durationUs <= 0) {
      return;
    }
    let next: number | null = null;
    if (event.key === "ArrowLeft") {
      next = Math.max(0, currentTimeUs - SEEK_STEP_US);
    } else if (event.key === "ArrowRight") {
      next = Math.min(durationUs, currentTimeUs + SEEK_STEP_US);
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = durationUs;
    }
    if (next !== null) {
      event.preventDefault();
      onSeek(Math.round(next));
    }
  }

  return (
    <div className="timeline" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="timeline-canvas"
        style={{ height: HEIGHT_PX }}
        tabIndex={0}
        role="slider"
        aria-label="Detection timeline. Click to seek, drag to select a correction range, arrow keys seek five seconds."
        aria-valuemin={0}
        aria-valuemax={Math.max(0, durationUs)}
        aria-valuenow={Math.round(clamp01(durationUs > 0 ? currentTimeUs / durationUs : 0) * Math.max(0, durationUs))}
        aria-valuetext={formatTime(currentTimeUs)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={handleKeyDown}
      />
      <div className="timeline-scale" aria-hidden="true">
        <span>0:00</span>
        <span>{formatTime(durationUs > 0 ? durationUs / 2 : 0)}</span>
        <span>{formatTime(durationUs)}</span>
      </div>
      <div className="timeline-legend">
        <span className="legend-chip">
          <span className="legend-swatch" style={{ background: "#3fb27f" }} /> Selected person
        </span>
        <span className="legend-chip">
          <span className="legend-swatch" style={{ background: "#d9a13b" }} /> Ambiguous match
        </span>
        <span className="legend-chip">
          <span className="legend-swatch" style={{ background: "#5a6672" }} /> Other / unassigned
        </span>
      </div>
    </div>
  );
}
