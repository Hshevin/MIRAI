import { formatTimePrecise } from "../format";
import { useI18n } from "../i18n";
import { BackIcon, ForwardIcon, MuteIcon, PauseIcon, PlayIcon, VolumeIcon } from "./Icons";

interface PlayerControlsProps {
  playing: boolean;
  muted: boolean;
  currentTimeUs: number;
  durationUs: number;
  onTogglePlay: () => void;
  onSeekBy: (deltaUs: number) => void;
  onToggleMute: () => void;
}

export function PlayerControls({
  playing,
  muted,
  currentTimeUs,
  durationUs,
  onTogglePlay,
  onSeekBy,
  onToggleMute,
}: PlayerControlsProps) {
  const { t } = useI18n();
  return (
    <div className="player-controls">
      <button
        type="button"
        className="icon-btn"
        aria-label={t("player.back")}
        title={`${t("player.back")} (←)`}
        onClick={() => onSeekBy(-1_000_000)}
      >
        <BackIcon />
      </button>
      <button
        type="button"
        className="icon-btn play"
        aria-label={playing ? t("player.pause") : t("player.play")}
        title={`${playing ? t("player.pause") : t("player.play")} (Space)`}
        onClick={onTogglePlay}
      >
        {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label={t("player.forward")}
        title={`${t("player.forward")} (→)`}
        onClick={() => onSeekBy(1_000_000)}
      >
        <ForwardIcon />
      </button>
      <span className="timecode mono">
        {formatTimePrecise(currentTimeUs)}
        <span className="muted"> / {formatTimePrecise(durationUs)}</span>
      </span>
      <span className="spacer" />
      <button
        type="button"
        className="icon-btn"
        aria-label={muted ? t("player.unmute") : t("player.mute")}
        title={muted ? t("player.unmute") : t("player.mute")}
        onClick={onToggleMute}
      >
        {muted ? <MuteIcon /> : <VolumeIcon />}
      </button>
    </div>
  );
}
