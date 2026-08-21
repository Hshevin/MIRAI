import { thumbnailUrl } from "../api";
import { formatPercent, formatTime } from "../format";
import type { Person, Video } from "../types";

interface PeopleGalleryProps {
  video: Video;
  people: Person[];
  selectingId: string | null;
  onSelect: (person: Person) => void;
}

export function PeopleGallery({ video, people, selectingId, onSelect }: PeopleGalleryProps) {
  return (
    <section className="panel" aria-labelledby="select-title">
      <h2 id="select-title">Who should stay visible?</h2>
      <p className="hint">
        Select the one primary person to keep clear in <strong>{video.original_name}</strong>.
        Everyone and everything else will be mosaicked and blurred.
      </p>
      {people.length === 0 && (
        <p className="empty-state">No people were found in this video. Try re-running analysis.</p>
      )}
      <div className="people-grid">
        {people.map((person) => {
          const [primary, ...rest] = person.thumbnails;
          const busy = selectingId !== null;
          return (
            <button
              key={person.id}
              type="button"
              className="person-card"
              disabled={busy}
              onClick={() => onSelect(person)}
            >
              <span className="person-thumb">
                {primary ? (
                  <img src={thumbnailUrl(primary.id)} alt={`Thumbnail of ${person.display_label}`} loading="lazy" />
                ) : (
                  <span className="thumb-placeholder" aria-hidden="true" />
                )}
              </span>
              {rest.length > 0 && (
                <span className="thumb-strip" aria-hidden="true">
                  {rest.slice(0, 4).map((thumb) => (
                    <img key={thumb.id} src={thumbnailUrl(thumb.id)} alt="" loading="lazy" />
                  ))}
                </span>
              )}
              <span className="person-name">
                {person.display_label}
                {selectingId === person.id && <span className="hint"> · creating selection…</span>}
              </span>
              <span className="person-stats">
                {formatTime(person.screen_time_us)} on screen · {person.appearance_count}{" "}
                {person.appearance_count === 1 ? "appearance" : "appearances"}
              </span>
              <span className="person-stats">
                {formatPercent(person.association_score)} association confidence
                {person.ambiguous_appearances > 0 && (
                  <span className="badge-amber">
                    {person.ambiguous_appearances} uncertain{" "}
                    {person.ambiguous_appearances === 1 ? "appearance" : "appearances"}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
