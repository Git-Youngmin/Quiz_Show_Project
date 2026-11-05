import { useEffect, useState } from "react";
import { serverNow, useGameStore } from "../store/useGameStore";

/**
 * 현재 단계의 남은 시간(ms). 서버 시계 기준이라 모든 기기에서 동일하게 보임.
 * phaseEndsAt 이 없으면 null.
 */
export function useCountdown(intervalMs = 100): number | null {
  const endsAt = useGameStore((s) => s.game.phaseEndsAt);
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (endsAt === null) {
      setRemaining(null);
      return;
    }
    const tick = () => setRemaining(Math.max(0, endsAt - serverNow()));
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [endsAt, intervalMs]);

  return remaining;
}
