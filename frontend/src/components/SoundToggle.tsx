import { audio } from "../audio/AudioManager";
import { useAudioState } from "../audio/useGameAudio";

/** 우측 상단 음소거 토글. 브라우저가 소리를 막고 있으면 "사운드 켜기" 안내로 바뀜 */
export function SoundToggle() {
  const { muted, locked } = useAudioState();

  if (locked && !muted) {
    return (
      <button type="button" className="sound-toggle locked" onClick={() => audio.unlock()}>
        🔇 클릭해서 사운드 켜기
      </button>
    );
  }
  return (
    <button
      type="button"
      className="sound-toggle"
      aria-label={muted ? "소리 켜기" : "소리 끄기"}
      aria-pressed={muted}
      onClick={() => audio.setMuted(!muted)}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}
