import { useEffect, useState } from "react";
import type { ItemKind } from "@quiz/shared";
import { useGameStore } from "../store/useGameStore";

const KIND_LABEL: Record<ItemKind, string> = { banana: "🍌 바나나", crate: "📦 상자", ball: "🔴 공" };
const SHOW_MS = 3500;

/** 송출 화면 왼쪽 아래: "지우 → 📦 상자 투척!" 알림 (최근 4개, 3.5초 후 사라짐) */
export function ThrowFeed() {
  const obstacles = useGameStore((s) => s.obstacles);
  const players = useGameStore((s) => s.players);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (obstacles.length === 0) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [obstacles.length]);

  const recent = obstacles.filter((o) => now - o.receivedAt < SHOW_MS).slice(-4);
  if (recent.length === 0) return null;
  return (
    <div className="throw-feed" aria-live="polite">
      {recent.map((o) => (
        <div key={o.id} className="throw-feed-item">
          <b style={{ color: players[o.throwerId]?.color }}>{players[o.throwerId]?.name ?? "관전자"}</b> → {KIND_LABEL[o.kind]} 투척!
        </div>
      ))}
    </div>
  );
}
