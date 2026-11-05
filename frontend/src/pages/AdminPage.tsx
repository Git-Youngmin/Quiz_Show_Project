import { ConnectionStatus } from "../components/ConnectionStatus";
import { PlayerTable } from "../components/PlayerTable";
import { useRoomConnection } from "../lib/useRoomConnection";
import { useGameStore } from "../store/useGameStore";

/** 방장 패널 — 퀴즈 생성/게임 제어 UI 는 이후 단계에서 추가 */
export default function AdminPage() {
  useRoomConnection("admin");
  const count = useGameStore((s) => s.playerIds.length);

  return (
    <div className="page">
      <h1>관리자 패널</h1>
      <ConnectionStatus />
      <div className="card">
        <div className="row">
          <button className="btn" disabled>게임 시작</button>
          <button className="btn" disabled>다음 문제</button>
          <span>(Phase 2 예정)</span>
        </div>
      </div>
      <div className="card">
        <h3>참가자 {count}명</h3>
        <PlayerTable />
      </div>
    </div>
  );
}
