import { useEffect, useRef } from "react";
import { ConnectionStatus } from "../components/ConnectionStatus";
import { PlayerTable } from "../components/PlayerTable";
import { useRoomConnection } from "../lib/useRoomConnection";
import { useGameStore, useSelf } from "../store/useGameStore";

const SPEED = 5; // units/s

/**
 * 참가자 뷰 — Task 2-2 에서 R3F 캔버스 + Rapier 캐릭터로 교체.
 * 지금은 동기화 확인용으로 WASD/방향키 → sendMove 를 매 프레임 호출한다.
 */
export default function PlayPage() {
  useRoomConnection("player");
  const self = useSelf();
  const selfId = useGameStore((s) => s.selfId);
  const keys = useRef(new Set<string>());

  useEffect(() => {
    const down = (e: KeyboardEvent) => keys.current.add(e.key.toLowerCase());
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useEffect(() => {
    if (!selfId) return;
    // 서버가 정해준 스폰 위치에서 시작
    const start = useGameStore.getState().players[selfId];
    const pos = start ? [...start.p] : [0, 2, 0];
    let rot = 0;
    let last = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const k = keys.current;
      const dx = (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0);
      const dz = (k.has("s") || k.has("arrowdown") ? 1 : 0) - (k.has("w") || k.has("arrowup") ? 1 : 0);
      if (dx || dz) {
        const len = Math.hypot(dx, dz);
        pos[0] += (dx / len) * SPEED * dt;
        pos[2] += (dz / len) * SPEED * dt;
        rot = Math.atan2(dx, dz);
      }
      // 매 프레임 호출해도 스토어 내부에서 20Hz 로 스로틀링 + 정지 시 전송 생략
      useGameStore.getState().sendMove(pos[0], pos[1], pos[2], rot);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [selfId]);

  return (
    <div className="page">
      <h1>Play</h1>
      <ConnectionStatus />
      <div className="card">
        <p>
          {self ? (
            <>
              <span style={{ color: self.color }}>●</span> <b>{self.name}</b> 으로 접속 — WASD / 방향키로 이동 테스트
            </>
          ) : (
            "접속 중..."
          )}
        </p>
        <PlayerTable />
      </div>
    </div>
  );
}
