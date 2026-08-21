import { useRef, useState } from "react";
import type { MouseEvent, ReactNode, RefObject } from "react";
import type { MaskPromptInput } from "../types";
import { useToasts } from "./Toasts";
import { errorMessage } from "../api";

export type PromptMode = "point+" | "point-" | "box+" | "box-";

const MODES: { id: PromptMode; label: string; hint: string }[] = [
  { id: "point+", label: "+ Point", hint: "Click the person to keep." },
  { id: "point-", label: "− Point", hint: "Click a region to hide." },
  { id: "box+", label: "+ Box", hint: "Drag a box around the person to keep." },
  { id: "box-", label: "− Box", hint: "Drag a box around a region to hide." },
];

/** A click moves less than this many pixels; anything more is a drag (box). */
const DRAG_THRESHOLD_PX = 6;
/** Markers stay visible within ±0.5 s of their timestamp. */
const MARKER_WINDOW_US = 500_000;
/** Height reserved at the bottom so the native video controls stay clickable. */
const CONTROLS_STRIP_PX = 44;

interface LocalMarker {
  id: number;
  timestamp_us: number;
  kind: "point" | "box";
  positive: boolean;
  coordinates: number[];
}

interface DragState {
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface PromptOverlayProps {
  videoRef: RefObject<HTMLVideoElement>;
  currentTimeUs: number;
  onPrompt: (input: MaskPromptInput) => Promise<void>;
  children: ReactNode;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function PromptOverlay({ videoRef, currentTimeUs, onPrompt, children }: PromptOverlayProps) {
  const { notify } = useToasts();
  const [mode, setMode] = useState<PromptMode>("point+");
  const [drag, setDrag] = useState<DragState | null>(null);
  const [markers, setMarkers] = useState<LocalMarker[]>([]);
  const [saving, setSaving] = useState(false);
  const markerId = useRef(0);

  function toNormalized(clientX: number, clientY: number): [number, number] | null {
    const video = videoRef.current;
    if (!video) {
      return null;
    }
    const bounds = video.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) {
      return null;
    }
    return [
      clamp01((clientX - bounds.left) / bounds.width),
      clamp01((clientY - bounds.top) / bounds.height),
    ];
  }

  function timestampUs(): number {
    const video = videoRef.current;
    return Math.round((video?.currentTime ?? 0) * 1_000_000);
  }

  async function sendPrompt(kind: "point" | "box", positive: boolean, coordinates: number[]) {
    if (saving) {
      return;
    }
    setSaving(true);
    const input: MaskPromptInput = { timestamp_us: timestampUs(), kind, positive, coordinates };
    try {
      await onPrompt(input);
      markerId.current += 1;
      setMarkers((items) => [...items, { id: markerId.current, ...input }]);
    } catch (error) {
      notify("error", `Could not save prompt: ${errorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  }

  function handleMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }
    const point = toNormalized(event.clientX, event.clientY);
    if (!point) {
      return;
    }
    setDrag({
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: point[0],
      startY: point[1],
      currentX: point[0],
      currentY: point[1],
    });
  }

  function handleMouseMove(event: MouseEvent<HTMLDivElement>) {
    if (!drag) {
      return;
    }
    const point = toNormalized(event.clientX, event.clientY);
    if (!point) {
      return;
    }
    setDrag({ ...drag, currentX: point[0], currentY: point[1] });
  }

  function handleMouseUp(event: MouseEvent<HTMLDivElement>) {
    if (!drag) {
      return;
    }
    const point = toNormalized(event.clientX, event.clientY);
    const moved = Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY);
    const start = drag;
    setDrag(null);
    if (!point) {
      return;
    }
    if (mode === "point+" || mode === "point-") {
      void sendPrompt("point", mode === "point+", [point[0], point[1]]);
      return;
    }
    if (moved < DRAG_THRESHOLD_PX) {
      notify("info", "Drag to draw a box, or switch to a point mode to click.");
      return;
    }
    const x1 = Math.min(start.startX, point[0]);
    const y1 = Math.min(start.startY, point[1]);
    const x2 = Math.max(start.startX, point[0]);
    const y2 = Math.max(start.startY, point[1]);
    void sendPrompt("box", mode === "box+", [x1, y1, x2, y2]);
  }

  function handleContextMenu(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const point = toNormalized(event.clientX, event.clientY);
    if (point) {
      void sendPrompt("point", false, [point[0], point[1]]);
    }
  }

  const activeHint = MODES.find((item) => item.id === mode)?.hint ?? "";
  const visibleMarkers = markers.filter(
    (marker) => Math.abs(marker.timestamp_us - currentTimeUs) <= MARKER_WINDOW_US,
  );

  return (
    <div className="prompt-editor">
      <div className="prompt-toolbar" role="group" aria-label="Mask prompt mode">
        {MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`mode-btn ${mode === item.id ? "active" : ""}`}
            aria-pressed={mode === item.id}
            onClick={() => setMode(item.id)}
          >
            {item.label}
          </button>
        ))}
        <span className="prompt-hint">
          {activeHint} Right-click always adds a negative point.
        </span>
      </div>
      <div className="player-shell">
        {children}
        <div
          className="prompt-capture"
          style={{ bottom: CONTROLS_STRIP_PX }}
          role="img"
          aria-label="Mask prompt overlay. Click to add a point, drag to draw a box, right-click for a negative point. Use the video controls below to seek."
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => setDrag(null)}
          onContextMenu={handleContextMenu}
        />
        <div className="prompt-layer" aria-hidden="true">
          {visibleMarkers.map((marker) =>
            marker.kind === "point" ? (
              <span
                key={marker.id}
                className={`marker-dot ${marker.positive ? "positive" : "negative"}`}
                style={{
                  left: `${marker.coordinates[0] * 100}%`,
                  top: `${marker.coordinates[1] * 100}%`,
                }}
              >
                {marker.positive ? "+" : "−"}
              </span>
            ) : (
              <span
                key={marker.id}
                className={`marker-box ${marker.positive ? "positive" : "negative"}`}
                style={{
                  left: `${Math.min(marker.coordinates[0], marker.coordinates[2]) * 100}%`,
                  top: `${Math.min(marker.coordinates[1], marker.coordinates[3]) * 100}%`,
                  width: `${Math.abs(marker.coordinates[2] - marker.coordinates[0]) * 100}%`,
                  height: `${Math.abs(marker.coordinates[3] - marker.coordinates[1]) * 100}%`,
                }}
              />
            ),
          )}
          {drag && (mode === "box+" || mode === "box-") && (
            <span
              className={`marker-box draft ${mode === "box+" ? "positive" : "negative"}`}
              style={{
                left: `${Math.min(drag.startX, drag.currentX) * 100}%`,
                top: `${Math.min(drag.startY, drag.currentY) * 100}%`,
                width: `${Math.abs(drag.currentX - drag.startX) * 100}%`,
                height: `${Math.abs(drag.currentY - drag.startY) * 100}%`,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
