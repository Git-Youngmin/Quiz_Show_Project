/**
 * 사운드 파일 목록 — 실제 음원으로 교체할 때는 frontend/public/sounds/ 의 같은 이름 파일을 덮어쓰면 된다.
 * (현재 파일은 scripts/generate-placeholder-sounds.py 로 합성한 임시 음원)
 */
const base = `${import.meta.env.BASE_URL}sounds/`;

export type BgmName = "waiting" | "tension";
export type SfxName = "jump" | "fall" | "pop" | "fanfare" | "tick" | "barrier" | "drop" | "throw" | "bonk";

export const BGM: Record<BgmName, { src: string; volume: number }> = {
  /** 대기 중 잔잔한 배경음 (루프) */
  waiting: { src: `${base}bgm_waiting.mp3`, volume: 0.35 },
  /** 카운트다운 ~ 문제 진행 중 긴장감 있는 비트 (루프) */
  tension: { src: `${base}bgm_tension.mp3`, volume: 0.55 },
};

export const SFX: Record<SfxName, { src: string; volume: number }> = {
  jump: { src: `${base}jump.mp3`, volume: 0.35 },
  /** 탈락해 떨어질 때 비명/낙하음 */
  fall: { src: `${base}fall.mp3`, volume: 0.7 },
  /** 우승 폭죽 펑 */
  pop: { src: `${base}pop.mp3`, volume: 0.6 },
  /** 우승 팡파르 */
  fanfare: { src: `${base}fanfare.mp3`, volume: 0.8 },
  /** 카운트다운 초읽기 */
  tick: { src: `${base}tick.mp3`, volume: 0.5 },
  /** 차단벽 솟아오름 */
  barrier: { src: `${base}barrier.mp3`, volume: 0.6 },
  /** 오답 바닥 붕괴 */
  drop: { src: `${base}drop.mp3`, volume: 0.8 },
  /** 관전석 발사대에서 방해물 발사 (휘익) */
  throw: { src: `${base}throw.mp3`, volume: 0.5 },
  /** 생존자가 방해물에 맞음 (뿅) */
  bonk: { src: `${base}bonk.mp3`, volume: 0.7 },
};
