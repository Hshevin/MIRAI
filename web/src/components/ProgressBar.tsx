interface ProgressBarProps {
  /** Fraction 0..1. */
  value: number;
  label?: string;
}

export function ProgressBar({ value, label }: ProgressBarProps) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      className="progress-bar"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? "Progress"}
    >
      <div className="progress-fill" style={{ width: `${percent}%` }} />
      {label !== undefined && <span className="progress-text">{label}</span>}
    </div>
  );
}
