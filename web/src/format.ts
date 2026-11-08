/** Microseconds → m:ss (minutes are unbounded, e.g. 75:30 for 1h15m30s). */
export function formatTime(microseconds: number | null | undefined): string {
  if (microseconds == null || !Number.isFinite(microseconds) || microseconds < 0) {
    return "0:00";
  }
  const totalSeconds = Math.floor(microseconds / 1_000_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/** Fraction 0..1 → "42%". Out-of-range input is clamped. */
export function formatPercent(fraction: number | null | undefined): string {
  if (fraction == null || !Number.isFinite(fraction)) {
    return "0%";
  }
  const clamped = Math.min(1, Math.max(0, fraction));
  return `${Math.round(clamped * 100)}%`;
}

/** Microseconds → m:ss.t with tenths, for frame-accurate editor readouts. */
export function formatTimePrecise(microseconds: number | null | undefined): string {
  if (microseconds == null || !Number.isFinite(microseconds) || microseconds < 0) {
    return "0:00.0";
  }
  const tenths = Math.floor(microseconds / 100_000);
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor((tenths % 600) / 10);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths % 10}`;
}
