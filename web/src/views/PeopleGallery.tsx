import { useEffect, useState } from "react";
import { thumbnailUrl } from "../api";
import { formatPercent, formatTime } from "../format";
import { useI18n } from "../i18n";
import type { Person, Revision, Video } from "../types";
import { AlertIcon, ArrowRightIcon, RefreshIcon, UserIcon } from "../components/Icons";

interface PeopleGalleryProps {
  video: Video;
  people: Person[];
  /** Existing revisions for this video, newest first. */
  revisions: Revision[];
  creating: boolean;
  onConfirm: (person: Person) => void;
  onResume: (revision: Revision) => void;
  onReanalyze: () => void;
}

function Thumb({ id, alt }: { id: string | undefined; alt: string }) {
  return id ? (
    <img src={thumbnailUrl(id)} alt={alt} loading="lazy" />
  ) : (
    <span className="thumb-empty" aria-hidden="true">
      <UserIcon size={28} />
    </span>
  );
}

export function PeopleGallery({
  video,
  people,
  revisions,
  creating,
  onConfirm,
  onResume,
  onReanalyze,
}: PeopleGalleryProps) {
  const { t } = useI18n();
  const [focusedId, setFocusedId] = useState<string | null>(people[0]?.id ?? null);

  useEffect(() => {
    if (!people.some((person) => person.id === focusedId)) {
      setFocusedId(people[0]?.id ?? null);
    }
  }, [people, focusedId]);

  const focused = people.find((person) => person.id === focusedId) ?? null;
  const latest = revisions[0] ?? null;
  const latestPerson = latest ? people.find((person) => person.id === latest.person_id) : undefined;

  return (
    <section className="page" aria-labelledby="select-title">
      <header className="page-head">
        <h1 id="select-title">{t("select.title")}</h1>
        <p className="lead">{t("select.lead", { name: video.original_name })}</p>
      </header>

      {latest && latestPerson && (
        <button type="button" className="resume-card" onClick={() => onResume(latest)}>
          <span className="muted small">{t("select.resumeTitle")}</span>
          <strong>
            {t("select.resume", { name: latestPerson.display_label, ordinal: latest.ordinal })}
          </strong>
          <ArrowRightIcon />
        </button>
      )}

      {people.length === 0 ? (
        <div className="card empty-card">
          <p>{t("select.empty")}</p>
          <button type="button" className="btn subtle" onClick={onReanalyze}>
            <RefreshIcon />
            {t("select.reanalyze")}
          </button>
        </div>
      ) : (
        <div className="select-layout">
          <div className="people-grid" role="listbox" aria-label={t("select.title")}>
            {people.map((person) => (
              <button
                key={person.id}
                type="button"
                role="option"
                aria-selected={person.id === focusedId}
                className={`person-card ${person.id === focusedId ? "selected" : ""}`}
                onClick={() => setFocusedId(person.id)}
                onDoubleClick={() => !creating && onConfirm(person)}
              >
                <span className="person-thumb">
                  <Thumb id={person.thumbnails[0]?.id} alt={person.display_label} />
                  <span className="person-label">{person.display_label}</span>
                  {person.ambiguous_appearances > 0 && (
                    <span
                      className="person-flag"
                      title={t("select.uncertain", { count: person.ambiguous_appearances })}
                    >
                      <AlertIcon size={12} />
                      {person.ambiguous_appearances}
                    </span>
                  )}
                </span>
                <span className="person-meta">
                  <span>{t("select.onScreen", { time: formatTime(person.screen_time_us) })}</span>
                  <span>{t("select.appearances", { count: person.appearance_count })}</span>
                </span>
              </button>
            ))}
          </div>

          <aside className="card person-detail" aria-live="polite">
            {focused ? (
              <>
                <div className="detail-hero">
                  <Thumb id={focused.thumbnails[0]?.id} alt={focused.display_label} />
                </div>
                {focused.thumbnails.length > 1 && (
                  <div className="detail-strip">
                    {focused.thumbnails.slice(1, 5).map((thumb) => (
                      <img key={thumb.id} src={thumbnailUrl(thumb.id)} alt="" loading="lazy" />
                    ))}
                  </div>
                )}
                <h2>{focused.display_label}</h2>
                <dl className="detail-stats">
                  <div>
                    <dt>{t("select.stat.screen")}</dt>
                    <dd>{formatTime(focused.screen_time_us)}</dd>
                  </div>
                  <div>
                    <dt>{t("select.stat.appearances")}</dt>
                    <dd>{focused.appearance_count}</dd>
                  </div>
                  <div>
                    <dt>{t("select.stat.confidence")}</dt>
                    <dd>{formatPercent(focused.association_score)}</dd>
                  </div>
                </dl>
                {focused.ambiguous_appearances > 0 && (
                  <p className="callout warn small">
                    <AlertIcon size={16} />
                    <span>
                      {t("select.uncertain", { count: focused.ambiguous_appearances })} ·{" "}
                      {t("select.uncertainNote")}
                    </span>
                  </p>
                )}
                <button
                  type="button"
                  className="btn primary block"
                  disabled={creating}
                  onClick={() => onConfirm(focused)}
                >
                  {creating
                    ? t("select.creating")
                    : t("select.confirm", { name: focused.display_label })}
                </button>
              </>
            ) : (
              <p className="muted">{t("select.pick")}</p>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
