import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { Detection, TimeRange } from "../types";
import {
  CELL_AMBIGUOUS,
  CELL_OTHER,
  CELL_SELECTED,
  buildTimelineModel,
  type OverrideSpan,
  type TimelineModel,
} from "../timeline";
import { formatTime, formatTimePrecise } from "../format";
import { useI18n } from "../i18n";

const RULER_PX = 22;
const GUTTER_PX = 44;
const LANES_MAX_PX = 168;
const DRAG_THRESHOLD_PX = 4;
const STEP_US = 1_000_000;
const BRIDGE_US = 250_000;
const TICK_STEPS_S = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

interface Palette {
  selected: string;
  ambiguous: string;
  other: string;
  include: string;
  exclude: string;
  brand: string;
  brandSoft: string;
  fg: string;
  fgMuted: string;
  fgFaint: string;
  line: string;
  stripe: string;
}

/** Timeline colours come from CSS custom properties so the canvas follows the design tokens. */
function readPalette(): Palette {
  const style = getComputedStyle(document.documentElement);
  const value = (name: string) => style.getPropertyValue(name).trim();
  return {
    selected: value("--clear"),
    ambiguous: value("--warn"),
    other: value("--masked"),
    include: value("--clear"),
    exclude: value("--danger"),
    brand: value("--brand"),
    brandSoft: value("--brand-soft"),
    fg: value("--fg-0"),
    fgMuted: value("--fg-1"),
    fgFaint: value("--fg-2"),
    line: value("--line"),
    stripe: value("--bg-2"),
  };
}

interface Geometry {
  height: number;
  laneHeight: number;
  laneGap: number;
  lanesTop: number;
}

function layout(laneCount: number): Geometry {
  let laneHeight = laneCount <= 6 ? 12 : laneCount <= 12 ? 9 : 6;
  let laneGap = laneHeight >= 9 ? 4 : 2;
  const needed = laneCount * (laneHeight + laneGap) + 10;
  if (needed > LANES_MAX_PX) {
    laneGap = 1;
    laneHeight = Math.max(1, Math.floor((LANES_MAX_PX - 10) / Math.max(1, laneCount)) - laneGap);
  }
  const lanesHeight = Math.max(48, Math.min(LANES_MAX_PX, laneCount * (laneHeight + laneGap) + 10));
  return { height: RULER_PX + lanesHeight, laneHeight, laneGap, lanesTop: RULER_PX + 6 };
}

function laneY(geometry: Geometry, index: number): number {
  return geometry.lanesTop + index * (geometry.laneHeight + geometry.laneGap);
}

/** Fill short empty gaps between columns of the same kind so sampled frames read as one span. */
function bridgeGaps(cells: Uint8Array, maxGap: number): Uint8Array {
  const filled = cells.slice();
  let lastIndex = -1;
  for (let column = 0; column < cells.length; column += 1) {
    const value = cells[column];
    if (value === 0) {
      continue;
    }
    if (lastIndex >= 0 && cells[lastIndex] === value && column - lastIndex <= maxGap + 1) {
      filled.fill(value, lastIndex + 1, column);
    }
    lastIndex = column;
  }
  return filled;
}

/** Detection lanes are drawn run-length encoded into an offscreen canvas cached per model. */
function renderLanes(
  model: TimelineModel,
  geometry: Geometry,
  width: number,
  dpr: number,
  palette: Palette,
): HTMLCanvasElement {
  const offscreen = document.createElement("canvas");
  offscreen.width = Math.max(1, Math.round(width * dpr));
  offscreen.height = Math.round(geometry.height * dpr);
  const ctx = offscreen.getContext("2d");
  if (!ctx) {
    return offscreen;
  }
  ctx.scale(dpr, dpr);
  // Frame-to-frame spacing leaves empty columns; spans under ~0.25 s read as continuous.
  const bridge = Math.max(
    1,
    Math.ceil((model.columns * BRIDGE_US) / Math.max(1, model.durationUs)),
  );
  const colors: Record<number, string> = {
    [CELL_OTHER]: palette.other,
    [CELL_SELECTED]: palette.selected,
    [CELL_AMBIGUOUS]: palette.ambiguous,
  };
  model.lanes.forEach((lane, laneIndex) => {
    const y = laneY(geometry, laneIndex);
    if (laneIndex % 2 === 0) {
      ctx.fillStyle = palette.stripe;
      ctx.fillRect(
        GUTTER_PX,
        y - geometry.laneGap / 2,
        model.columns,
        geometry.laneHeight + geometry.laneGap,
      );
    }
    if (geometry.laneHeight >= 8) {
      ctx.fillStyle = palette.fgFaint;
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textBaseline = "middle";
      ctx.textAlign = "right";
      ctx.fillText(`#${laneIndex + 1}`, GUTTER_PX - 8, y + geometry.laneHeight / 2);
    }
    const cells = bridgeGaps(lane.cells, bridge);
    let runValue = 0;
    let runStart = 0;
    for (let column = 0; column <= model.columns; column += 1) {
      const value = column < model.columns ? cells[column] : -1;
      if (value !== runValue) {
        if (runValue > 0) {
          ctx.fillStyle = colors[runValue];
          ctx.beginPath();
          ctx.roundRect(
            GUTTER_PX + runStart,
            y,
            Math.max(1, column - runStart),
            geometry.laneHeight,
            Math.min(3, geometry.laneHeight / 2),
          );
          ctx.fill();
        }
        runValue = value;
        runStart = column;
      }
    }
  });
  return offscreen;
}

interface TimelineStripProps {
  detections: Detection[];
  durationUs: number;
  currentTimeUs: number;
  selectedPersonId: string;
  range: TimeRange | null;
  overrides: OverrideSpan[];
  onSeek: (us: number) => void;
  onRangeSelect: (range: TimeRange | null) => void;
}

type DragMode = { kind: "scrub" } | { kind: "lanes"; startX: number };

interface Hover {
  x: number;
  y: number;
  timeUs: number;
  lane: number | null;
}

export function TimelineStrip({
  detections,
  durationUs,
  currentTimeUs,
  selectedPersonId,
  range,
  overrides,
  onSeek,
  onRangeSelect,
}: TimelineStripProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const laneCacheRef = useRef<{ key: unknown[]; canvas: HTMLCanvasElement } | null>(null);
  const paletteRef = useRef<Palette | null>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<DragMode | null>(null);
  const [liveRange, setLiveRange] = useState<TimeRange | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);

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

  const timeWidth = Math.max(1, width - GUTTER_PX);
  const model = useMemo(
    () => buildTimelineModel(detections, durationUs, timeWidth, selectedPersonId),
    [detections, durationUs, timeWidth, selectedPersonId],
  );
  const geometry = useMemo(() => layout(model.lanes.length), [model.lanes.length]);
  const laneIndex = useMemo(
    () => new Map(model.lanes.map((lane, index) => [lane.trackletId, index])),
    [model],
  );

  function usToX(us: number): number {
    return durationUs > 0
      ? GUTTER_PX + Math.min(1, Math.max(0, us / durationUs)) * timeWidth
      : GUTTER_PX;
  }

  function xToUs(x: number): number {
    if (durationUs <= 0) {
      return 0;
    }
    return Math.min(1, Math.max(0, (x - GUTTER_PX) / timeWidth)) * durationUs;
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) {
      return;
    }
    const palette = (paletteRef.current ??= readPalette());
    const dpr = window.devicePixelRatio || 1;
    const height = geometry.height;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    // Ruler with "nice" tick spacing of at least ~80 px.
    ctx.fillStyle = palette.line;
    ctx.fillRect(GUTTER_PX, RULER_PX - 1, timeWidth, 1);
    if (durationUs > 0) {
      const durationS = durationUs / 1_000_000;
      const step =
        TICK_STEPS_S.find((candidate) => (candidate / durationS) * timeWidth >= 80) ?? 3600;
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      for (let second = 0; second <= durationS; second += step) {
        const x = usToX(second * 1_000_000);
        ctx.fillStyle = palette.line;
        ctx.fillRect(Math.round(x), RULER_PX - 6, 1, 6);
        ctx.fillStyle = palette.fgFaint;
        ctx.fillText(formatTime(second * 1_000_000), x + 4, RULER_PX / 2 - 1);
      }
    }

    if (model.lanes.length === 0 || durationUs <= 0) {
      ctx.fillStyle = palette.fgFaint;
      ctx.font = "12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        durationUs <= 0 ? t("timeline.noDuration") : t("timeline.empty"),
        GUTTER_PX + timeWidth / 2,
        RULER_PX + (height - RULER_PX) / 2,
      );
    } else {
      const key = [model, geometry, width, dpr];
      let cache = laneCacheRef.current;
      if (!cache || cache.key.some((part, index) => part !== key[index])) {
        cache = { key, canvas: renderLanes(model, geometry, width, dpr, palette) };
        laneCacheRef.current = cache;
      }
      ctx.drawImage(cache.canvas, 0, 0, width, height);

      // User corrections are outlined on their lane: solid for include, dashed for exclude.
      for (const override of overrides) {
        const index = laneIndex.get(override.tracklet_id);
        if (index === undefined) {
          continue;
        }
        const x1 = usToX(override.start_us);
        const x2 = usToX(override.end_us);
        const y = laneY(geometry, index) - 1.5;
        const include = override.decision === "include";
        ctx.strokeStyle = include ? palette.include : palette.exclude;
        ctx.lineWidth = 1.5;
        ctx.setLineDash(include ? [] : [3, 2]);
        ctx.strokeRect(x1, y, Math.max(2, x2 - x1), geometry.laneHeight + 3);
        ctx.setLineDash([]);
      }
    }

    const shownRange = liveRange ?? range;
    if (shownRange && durationUs > 0) {
      const x1 = usToX(shownRange.startUs);
      const x2 = usToX(shownRange.endUs);
      ctx.fillStyle = palette.brandSoft;
      ctx.fillRect(x1, 0, Math.max(1, x2 - x1), height);
      ctx.fillStyle = palette.brand;
      ctx.fillRect(x1, 0, 1.5, height);
      ctx.fillRect(x2 - 1.5, 0, 1.5, height);
    }

    if (hover && !drag) {
      ctx.fillStyle = palette.fgFaint;
      ctx.fillRect(Math.round(hover.x), RULER_PX, 1, height - RULER_PX);
    }

    if (durationUs > 0) {
      const playheadX = usToX(currentTimeUs);
      ctx.fillStyle = palette.fg;
      ctx.fillRect(playheadX - 0.75, 4, 1.5, height - 4);
      ctx.beginPath();
      ctx.moveTo(playheadX - 5, 2);
      ctx.lineTo(playheadX + 5, 2);
      ctx.lineTo(playheadX, 9);
      ctx.closePath();
      ctx.fill();
    }
    // usToX/xToUs derive only from width and durationUs, which are listed.
  }, [
    model,
    geometry,
    width,
    durationUs,
    currentTimeUs,
    range,
    liveRange,
    overrides,
    laneIndex,
    hover,
    drag,
    t,
  ]);

  function localPoint(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const bounds = canvasRef.current?.getBoundingClientRect();
    return bounds
      ? { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
      : { x: 0, y: 0 };
  }

  function laneAt(y: number): number | null {
    const index = Math.floor(
      (y - geometry.lanesTop + geometry.laneGap / 2) / (geometry.laneHeight + geometry.laneGap),
    );
    return index >= 0 && index < model.lanes.length ? index : null;
  }

  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 || durationUs <= 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const { x, y } = localPoint(event);
    setLiveRange(null);
    if (y < RULER_PX) {
      setDrag({ kind: "scrub" });
      onSeek(Math.round(xToUs(x)));
    } else {
      setDrag({ kind: "lanes", startX: x });
    }
  }

  function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const { x, y } = localPoint(event);
    setHover(
      x >= GUTTER_PX ? { x, y, timeUs: xToUs(x), lane: y >= RULER_PX ? laneAt(y) : null } : null,
    );
    if (!drag) {
      return;
    }
    if (drag.kind === "scrub") {
      onSeek(Math.round(xToUs(x)));
      return;
    }
    if (Math.abs(x - drag.startX) < DRAG_THRESHOLD_PX && !liveRange) {
      return;
    }
    const a = xToUs(drag.startX);
    const b = xToUs(x);
    setLiveRange({ startUs: Math.min(a, b), endUs: Math.max(a, b) });
  }

  function handlePointerUp(event: PointerEvent<HTMLCanvasElement>) {
    const current = drag;
    setDrag(null);
    if (!current || current.kind === "scrub") {
      return;
    }
    if (liveRange) {
      const startUs = Math.max(0, Math.floor(liveRange.startUs));
      const endUs = Math.max(startUs + 1, Math.ceil(liveRange.endUs));
      setLiveRange(null);
      onRangeSelect({ startUs, endUs });
      return;
    }
    onSeek(Math.round(xToUs(localPoint(event).x)));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLCanvasElement>) {
    if (durationUs <= 0) {
      return;
    }
    const step = event.shiftKey ? STEP_US * 5 : STEP_US;
    let next: number | null = null;
    if (event.key === "ArrowLeft") {
      next = Math.max(0, currentTimeUs - step);
    } else if (event.key === "ArrowRight") {
      next = Math.min(durationUs, currentTimeUs + step);
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = durationUs;
    } else if (event.key === "Escape" && range) {
      onRangeSelect(null);
      event.preventDefault();
    }
    if (next !== null) {
      event.preventDefault();
      onSeek(Math.round(next));
    }
  }

  const hoverLane = hover?.lane != null ? model.lanes[hover.lane] : undefined;

  return (
    <div className="timeline">
      <div className="timeline-canvas-wrap" ref={containerRef}>
        <canvas
          ref={canvasRef}
          className={`timeline-canvas ${drag?.kind === "lanes" ? "selecting" : ""}`}
          style={{ height: geometry.height }}
          tabIndex={0}
          role="slider"
          aria-label={t("timeline.aria")}
          aria-valuemin={0}
          aria-valuemax={Math.max(0, durationUs)}
          aria-valuenow={Math.round(Math.min(Math.max(0, currentTimeUs), Math.max(0, durationUs)))}
          aria-valuetext={formatTime(currentTimeUs)}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={() => setHover(null)}
          onKeyDown={handleKeyDown}
        />
        {hover && !drag && (
          <div
            className="timeline-tip"
            style={{
              left: Math.min(Math.max(hover.x, 60), width - 60),
              top: hover.y < RULER_PX ? RULER_PX + 4 : hover.y + 14,
            }}
          >
            <span className="mono">{formatTimePrecise(hover.timeUs)}</span>
            {hoverLane && hover.lane !== null && (
              <span>{t("timeline.track", { n: hover.lane + 1 })}</span>
            )}
          </div>
        )}
      </div>
      <div className="timeline-foot">
        <div className="legend">
          <span className="legend-item">
            <span className="swatch swatch-selected" /> {t("timeline.legend.selected")}
          </span>
          <span className="legend-item">
            <span className="swatch swatch-ambiguous" /> {t("timeline.legend.ambiguous")}
          </span>
          <span className="legend-item">
            <span className="swatch swatch-other" /> {t("timeline.legend.other")}
          </span>
          <span className="legend-item">
            <span className="swatch swatch-include" /> {t("timeline.legend.include")}
          </span>
          <span className="legend-item">
            <span className="swatch swatch-exclude" /> {t("timeline.legend.exclude")}
          </span>
        </div>
        <span className="muted small">{t("timeline.hint")}</span>
      </div>
    </div>
  );
}
