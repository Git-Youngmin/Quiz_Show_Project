import { ConnectionStatus } from "../components/ConnectionStatus";
import { PlayerTable } from "../components/PlayerTable";
import { useRoomConnection } from "../lib/useRoomConnection";

/** 방송 송출 뷰 — Task 2-2 에서 3D 월드 + 다이나믹 카메라로 교체 */
export default function DisplayPage() {
  useRoomConnection("display");

  return (
    <div className="page">
      <h1>Display (송출 화면)</h1>
      <ConnectionStatus />
      <div className="card">
        <p>3D 관전 뷰는 Task 2-2 에서 추가됩니다. 지금은 실시간 위치 수신 확인용 표입니다.</p>
        <PlayerTable />
      </div>
    </div>
  );
}
