import { useGameStore } from "../store/useGameStore";

/** 연결 상태 / 지연 / 에러 표시 배지 */
export function ConnectionStatus() {
  const status = useGameStore((s) => s.status);
  const roomId = useGameStore((s) => s.roomId);
  const latency = useGameStore((s) => s.latency);
  const lastError = useGameStore((s) => s.lastError);

  return (
    <div className="row mono">
      <span className={`badge ${status}`}>{status}</span>
      <span>room: {roomId ?? "-"}</span>
      {latency !== null && <span>{latency}ms</span>}
      {lastError && <span style={{ color: "#ff8a8a" }}>{lastError}</span>}
    </div>
  );
}
