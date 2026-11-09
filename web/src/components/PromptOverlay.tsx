import { useEffect, useState } from "react";
import type { CSSProperties, PointerEvent, RefObject } from "react";
import type { MaskPromptInput, RevisionPrompt } from "../types";

export type PromptPolarity = "keep" | "hide";
export type PromptShape = "point" | "box";

export interface PromptTool {
  polarity: PromptPolarity;
  shape: PromptShape;
}

/** A click moves less than this many pixels; anything more is a drag (box). */
const DRAG_THRESHOLD_PX = 6;
/** Markers stay visible within ±0.5 s of their timestamp. */
const MARKER_WINDOW_US = 500_000;

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface DragState {
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  positive: boolean;
}

interface PendingMarker {
  kind: "point" | "box";
  positive: boolean;
  coordinates: number[];
}

interface PromptOverlayProps {
  videoRef: RefObject<HTMLVideoElement>;
  currentTimeUs: number;
  prompts: RevisionPrompt[];
  tool: PromptTool;
  disabled?: boolean;
  ariaLabel: string;
  onPrompt: (input: MaskPromptInput) => Promise<void>;
  onInvalidBox: () => void;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** The rectangle the frame actually occupies inside an `object-fit: contain` video element. */
function contentRect(video: HTMLVideoElement): Rect {
  const boxWidth = video.clientWidth;
  const boxHeight = video.clientHeight;
  const naturalWidth = video.videoWidth || boxWidth;
  const naturalHeight = video.videoHeight || boxHeight;
  if (!boxWidth || !boxHeight || !naturalWidth || !naturalHeight) {
    return { left: 0, top: 0, width: boxWidth, height: boxHeight };
  }
  const scale = Math.min(boxWidth / naturalWidth, boxHeight / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  return {
    left: video.offsetLeft + (boxWidth - width) / 2,
    top: video.offsetTop + (boxHeight - height) / 2,
    width,
    height,
  };
}

function boxStyle(coordinates: number[]): CSSProperties {
  const [x1, y1, x2, y2] = coordinates;
  return {
    left: `${Math.min(x1, x2) * 100}%`,
    top: `${Math.min(y1, y2) * 100}%`,
    width: `${Math.abs(x2 - x1) * 100}%`,
    height: `${Math.abs(y2 - y1) * 100}%`,
  };
}

function Marker({ kind, positive, coordinates, pending }: PendingMarker & { pending?: boolean }) {
  const tone = `${positive ? "keep" : "hide"}${pending ? " pending" : ""}`;
  if (kind === "point") {
    return (
      <span
        className={`marker-dot ${tone}`}
        style={{ left: `${coordinates[0] * 100}%`, top: `${coordinates[1] * 100}%` }}
      >
        {positive ? "+" : "−"}
      </span>
    );
  }
  return <span className={`marker-box ${tone}`} style={boxStyle(coordinates)} />;
}

export function PromptOverlay({
  videoRef,
  currentTimeUs,
  prompts,
  tool,
  disabled,
  ariaLabel,
  onPrompt,
  onInvalidBox,
}: PromptOverlayProps) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pending, setPending] = useState<PendingMarker | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    const update = () => setRect(contentRect(video));
    const observer = new ResizeObserver(update);
    observer.observe(video);
    video.addEventListener("loadedmetadata", update);
    update();
    return () => {
      observer.disconnect();
      video.removeEventListener("loadedmetadata", update);
    };
  }, [videoRef]);

  function toNormalized(
    event: { clientX: number; clientY: number },
    target: Element,
  ): [number, number] {
    const bounds = target.getBoundingClientRect();
    return [
      clamp01((event.clientX - bounds.left) / Math.max(1, bounds.width)),
      clamp01((event.clientY - bounds.top) / Math.max(1, bounds.height)),
    ];
  }

  async function send(marker: PendingMarker) {
    setPending(marker);
    const timestamp = Math.round((videoRef.current?.currentTime ?? 0) * 1_000_000);
    try {
      await onPrompt({ timestamp_us: timestamp, ...marker });
    } finally {
      setPending(null);
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || disabled || pending) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const [x, y] = toNormalized(event, event.currentTarget);
    // Holding Alt temporarily inverts keep/hide.
    const positive = (tool.polarity === "keep") !== event.altKey;
    setDrag({
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: x,
      startY: y,
      currentX: x,
      currentY: y,
      positive,
    });
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag) {
      return;
    }
    const [x, y] = toNormalized(event, event.currentTarget);
    setDrag({ ...drag, currentX: x, currentY: y });
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!drag) {
      return;
    }
    const start = drag;
    setDrag(null);
    const [x, y] = toNormalized(event, event.currentTarget);
    if (tool.shape === "point") {
      void send({ kind: "point", positive: start.positive, coordinates: [x, y] });
      return;
    }
    const moved = Math.hypot(
      event.clientX - start.startClientX,
      event.clientY - start.startClientY,
    );
    if (moved < DRAG_THRESHOLD_PX) {
      onInvalidBox();
      return;
    }
    void send({
      kind: "box",
      positive: start.positive,
      coordinates: [
        Math.min(start.startX, x),
        Math.min(start.startY, y),
        Math.max(start.startX, x),
        Math.max(start.startY, y),
      ],
    });
  }

  if (!rect) {
    return null;
  }

  const visible = prompts.filter(
    (prompt) => Math.abs(prompt.timestamp_us - currentTimeUs) <= MARKER_WINDOW_US,
  );

  return (
    <div
      className={`prompt-layer shape-${tool.shape} ${disabled ? "disabled" : ""}`}
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      role="application"
      aria-label={ariaLabel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => setDrag(null)}
    >
      {visible.map((prompt) => (
        <Marker
          key={prompt.id}
          kind={prompt.kind}
          positive={prompt.positive}
          coordinates={prompt.coordinates}
        />
      ))}
      {pending && <Marker {...pending} pending />}
      {drag && tool.shape === "box" && (
        <Marker
          kind="box"
          positive={drag.positive}
          coordinates={[drag.startX, drag.startY, drag.currentX, drag.currentY]}
          pending
        />
      )}
    </div>
  );
}
