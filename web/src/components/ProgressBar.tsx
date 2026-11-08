interface ProgressBarProps {
  /** Fraction 0..1. */
  value: number;
  label?: string;
  /** Right-aligned secondary text, e.g. a percentage. */
  detail?: string;
  tone?: "brand" | "clear" | "danger";
}

export function ProgressBar({ value, label, detail, tone = "brand" }: ProgressBarProps) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className={`progress tone-${tone}`}>
      {(label || detail) && (
        <div className="progress-head">
          <span className="progress-label">{label}</span>
          <span className="progress-detail">{detail ?? `${percent}%`}</span>
        </div>
      )}
      <div
        className="progress-track"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? "Progress"}
      >
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
