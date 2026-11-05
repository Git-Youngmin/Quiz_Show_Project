import { Howl, Howler } from "howler";
import { BGM, SFX, type BgmName, type SfxName } from "./sounds";

const MUTE_KEY = "quiz-show:muted";

/**
 * howler.js 기반 사운드 관리자 (싱글턴).
 *  - BGM: 한 번에 하나만 재생, 전환 시 크로스페이드
 *  - SFX: 겹쳐 재생 가능, 재생마다 볼륨/피치(rate) 변주
 *  - Howl 객체는 처음 쓸 때 생성(lazy) → 첫 화면 로딩에 영향 없음
 *  - 음소거 상태는 localStorage 에 기억
 */
class AudioManager {
  private bgmHowls = new Map<BgmName, Howl>();
  private sfxHowls = new Map<SfxName, Howl>();
  private currentBgm: BgmName | null = null;
  /** 페이지별 BGM 볼륨 배율 (참가자 폰은 작게, 송출 화면은 크게) */
  private bgmScale = 1;
  private sfxScale = 1;
  private muted = false;
  private listeners = new Set<() => void>();
  private warned = new Set<string>();

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      /* 기본: 소리 켬 */
    }
    Howler.mute(this.muted);
    // 브라우저 자동재생 정책: 첫 클릭/터치/키 입력 때 AudioContext 를 깨움 (howler 기본 동작) → 상태 변화 알림
    for (const ev of ["pointerdown", "keydown", "touchend"]) {
      window.addEventListener(ev, () => setTimeout(() => this.emit(), 50), { passive: true });
    }
  }

  configure({ bgmScale = 1, sfxScale = 1 }: { bgmScale?: number; sfxScale?: number }) {
    this.bgmScale = bgmScale;
    this.sfxScale = sfxScale;
    const cur = this.currentBgm && this.bgmHowls.get(this.currentBgm);
    if (cur && this.currentBgm) cur.volume(BGM[this.currentBgm].volume * this.bgmScale);
  }

  // ───────────── BGM ─────────────

  playBgm(name: BgmName, fadeMs = 800) {
    if (this.currentBgm === name) return;
    this.stopBgm(fadeMs);
    const howl = this.getBgm(name);
    const target = BGM[name].volume * this.bgmScale;
    howl.volume(0);
    if (!howl.playing()) howl.play();
    howl.fade(0, target, fadeMs);
    this.currentBgm = name;
    this.debug("bgm", name);
    this.emit(); // AudioContext 가 이 시점에 생기므로 잠금 상태 갱신
  }

  /** 현재 BGM 페이드아웃 후 정지 (정적 연출) */
  stopBgm(fadeMs = 600) {
    const name = this.currentBgm;
    if (!name) return;
    this.currentBgm = null;
    this.debug("bgm-stop", name);
    const howl = this.bgmHowls.get(name);
    if (!howl) return;
    if (fadeMs <= 0) {
      howl.stop();
      return;
    }
    howl.fade(howl.volume(), 0, fadeMs);
    howl.once("fade", () => {
      // 페이드 도중 같은 BGM 이 다시 시작됐다면 멈추지 않음
      if (this.currentBgm !== name) howl.stop();
    });
  }

  // ───────────── SFX ─────────────

  playSfx(name: SfxName, { volume = 1, rate = 1, delayMs = 0 }: { volume?: number; rate?: number; delayMs?: number } = {}) {
    const play = () => {
      const howl = this.getSfx(name);
      const id = howl.play();
      howl.volume(SFX[name].volume * volume * this.sfxScale, id);
      if (rate !== 1) howl.rate(rate, id);
      this.debug("sfx", name);
      this.emit();
    };
    if (delayMs > 0) setTimeout(play, delayMs);
    else play();
  }

  // ───────────── 음소거 / 자동재생 잠금 ─────────────

  isMuted() {
    return this.muted;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    Howler.mute(muted);
    try {
      localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {
      /* ignore */
    }
    this.emit();
  }

  /** 아직 사용자 입력이 없어 브라우저가 소리를 막고 있는지 */
  isLocked() {
    return Howler.ctx?.state === "suspended";
  }

  async unlock() {
    try {
      await Howler.ctx?.resume();
    } catch {
      /* ignore */
    }
    this.emit();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  // ───────────── 내부 ─────────────

  /** 개발 모드: 재생 기록을 window.__audioLog 에 남겨 E2E 테스트에서 확인 */
  private debug(kind: string, name: string) {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __audioLog?: string[] };
    (w.__audioLog ??= []).push(`${kind}:${name}`);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private onLoadError = (src: string) => () => {
    // 파일이 없거나 형식 오류여도 게임은 계속 (경고는 파일당 1회)
    if (this.warned.has(src)) return;
    this.warned.add(src);
    console.warn(`[audio] 사운드를 불러오지 못했습니다: ${src}`);
  };

  private getBgm(name: BgmName) {
    let h = this.bgmHowls.get(name);
    if (!h) {
      h = new Howl({ src: [BGM[name].src], loop: true, volume: 0, onloaderror: this.onLoadError(BGM[name].src) });
      this.bgmHowls.set(name, h);
    }
    return h;
  }

  private getSfx(name: SfxName) {
    let h = this.sfxHowls.get(name);
    if (!h) {
      h = new Howl({ src: [SFX[name].src], onloaderror: this.onLoadError(SFX[name].src) });
      this.sfxHowls.set(name, h);
    }
    return h;
  }
}

export const audio = new AudioManager();
