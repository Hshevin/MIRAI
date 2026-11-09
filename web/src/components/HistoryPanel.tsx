import { useI18n } from "../i18n";
import type { RevisionHistoryEntry } from "../types";

interface HistoryPanelProps {
  history: RevisionHistoryEntry[];
  currentId: string;
  busy: boolean;
  onRestore: (revisionId: string) => void;
}

export function HistoryPanel({ history, currentId, busy, onRestore }: HistoryPanelProps) {
  const { t, locale } = useI18n();
  const timeFormat = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return (
    <section className="panel-section">
      <h3 className="section-title">{t("history.title")}</h3>
      <ol className="history-list">
        {[...history].reverse().map((entry) => {
          const current = entry.id === currentId;
          return (
            <li
              key={entry.id}
              className={`history-item change-${entry.change} ${current ? "current" : ""}`}
            >
              <span className="history-dot" aria-hidden="true" />
              <div className="history-text">
                <strong>{t(`history.change.${entry.change}`)}</strong>
                <span className="muted small mono">
                  r{entry.ordinal} · {timeFormat.format(new Date(entry.created_at))}
                </span>
              </div>
              {current ? (
                <span className="chip brand">{t("history.current")}</span>
              ) : (
                <button
                  type="button"
                  className="btn ghost small"
                  disabled={busy}
                  onClick={() => onRestore(entry.id)}
                >
                  {t("history.restore")}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
