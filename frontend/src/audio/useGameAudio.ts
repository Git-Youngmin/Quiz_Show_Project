import { useEffect, useSyncExternalStore } from "react";
import type { GamePhase } from "@quiz/shared";
import { serverNow, useGameStore } from "../store/useGameStore";
import { audio } from "./AudioManager";

/**
 * 게임 상태 머신 ↔ 사운드 연동. /play 와 /display 에서 한 번씩 호출.
 *
 *  단계            BGM                         SFX
 *  waiting         잔잔한 대기 음악            -
 *  countdown       긴장 비트 시작               초읽기 틱 (매초)
 *  question_active 긴장 비트 유지               차단벽 솟을 때 위잉
 *  reveal          ── 정적(페이드아웃) ──       -
 *  elimination     (무음 유지)                  바닥 붕괴 쿵 + 탈락자 비명
 *  game_over       팡파르 후 대기 음악 복귀     폭죽 펑 (Confetti 에서)
 *
 * mode
 *  - "play"    : 참가자 폰/PC. 내 캐릭터가 탈락할 때만 비명, BGM 은 작게
 *  - "display" : 방송 송출. 탈락자 수만큼(최대 3) 비명, BGM 은 크게
 */
export function useGameAudio(mode: "play" | "display") {
  useEffect(() => {
    audio.configure(mode === "play" ? { bgmScale: 0.6, sfxScale: 1 } : { bgmScale: 1, sfxScale: 1 });

    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => {
      const id = setTimeout(() => {
        timers.delete(id);
        fn();
      }, Math.max(0, ms));
      timers.add(id);
    };
    const clearTimers = () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };

    let prevPhase: GamePhase | null = null;
    let prevBarrierAt: number | null = null;
    let prevAlive = new Map<string, boolean>();
    let lastItemId = 0;

    const onPhase = (phase: GamePhase) => {
      const { game } = useGameStore.getState();
      clearTimers();
      switch (phase) {
        case "waiting":
          audio.playBgm("waiting", 1200);
          break;
        case "countdown": {
          audio.playBgm("tension", 300);
          // 남은 초마다 틱 (3, 2, 1) — 서버 시계 기준
          if (game.phaseEndsAt) {
            const remain = game.phaseEndsAt - serverNow();
            for (let s = Math.ceil(remain / 1000); s >= 1; s--) {
              later(() => audio.playSfx("tick", { rate: s === 1 ? 1.25 : 1 }), remain - s * 1000);
            }
          }
          break;
        }
        case "question_active":
          audio.playBgm("tension", 300);
          break;
        case "reveal":
          // 탈락 직전의 정적: BGM 을 끊어 긴장감 극대화
          audio.stopBgm(350);
          break;
        case "elimination":
          audio.stopBgm(0);
          audio.playSfx("drop");
          break;
        case "game_over":
          audio.stopBgm(200);
          if (game.winnerId) {
            audio.playSfx("fanfare", { delayMs: 150 });
            later(() => audio.playBgm("waiting", 2000), 4500);
          } else {
            later(() => audio.playBgm("waiting", 1500), 1500);
          }
          break;
      }
    };

    const unsubscribe = useGameStore.subscribe((state) => {
      const { game, status, players, selfId } = state;

      // ── 연결 끊김 → 모두 정지 ──
      if (status !== "open") {
        if (prevPhase !== null) {
          clearTimers();
          audio.stopBgm(300);
        }
        prevPhase = null;
        prevAlive = new Map();
        return;
      }

      // ── 단계 전환 ──
      if (game.phase !== prevPhase) {
        // 접속 직후(prevPhase=null)에는 진행 중인 단계의 BGM 만 맞추고 효과음은 생략
        if (prevPhase === null && (game.phase === "elimination" || game.phase === "reveal")) audio.stopBgm(0);
        else if (prevPhase === null && game.phase === "game_over") audio.playBgm("waiting");
        else onPhase(game.phase);
        prevPhase = game.phase;
      }

      // ── 차단벽 솟아오름 (barrierRaisesAt 은 question_active 진입 시 설정됨) ──
      if (game.barrierRaisesAt !== prevBarrierAt) {
        prevBarrierAt = game.barrierRaisesAt;
        if (game.barrierRaisesAt) later(() => audio.playSfx("barrier"), game.barrierRaisesAt - serverNow());
      }

      // ── 방해물 발사음: 송출 화면은 모든 투척, 참가자 화면은 내가 던진 것만 ──
      for (const item of state.obstacles) {
        if (item.id <= lastItemId) continue;
        lastItemId = item.id;
        if (mode === "display" || item.throwerId === selfId) {
          audio.playSfx("throw", { rate: 0.9 + Math.random() * 0.25, volume: mode === "display" ? 0.7 : 1 });
        }
      }

      // ── 탈락 비명: alive true → false 로 바뀐 플레이어 ──
      const fallen: string[] = [];
      const nextAlive = new Map<string, boolean>();
      for (const id in players) {
        const alive = players[id].alive;
        nextAlive.set(id, alive);
        if (prevAlive.get(id) === true && !alive) fallen.push(id);
      }
      prevAlive = nextAlive;
      if (fallen.length > 0) {
        if (mode === "play") {
          if (selfId && fallen.includes(selfId)) audio.playSfx("fall");
        } else {
          fallen.slice(0, 3).forEach((_, i) =>
            audio.playSfx("fall", { delayMs: i * 180 + Math.random() * 120, rate: 0.85 + Math.random() * 0.35, volume: 0.8 }),
          );
        }
      }
    });

    return () => {
      unsubscribe();
      clearTimers();
      audio.stopBgm(300);
    };
  }, [mode]);
}

/** 음소거 / 자동재생 잠금 상태 (React 구독용) */
export function useAudioState() {
  const muted = useSyncExternalStore((cb) => audio.subscribe(cb), () => audio.isMuted());
  const locked = useSyncExternalStore((cb) => audio.subscribe(cb), () => audio.isLocked());
  return { muted, locked };
}
