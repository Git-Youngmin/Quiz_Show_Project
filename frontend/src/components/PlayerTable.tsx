import { useGameStore } from "../store/useGameStore";

/** 디버그용 플레이어 위치 표 (스냅샷마다 리렌더 — 2D UI 라 부담 없음) */
export function PlayerTable() {
  const players = useGameStore((s) => s.players);
  const selfId = useGameStore((s) => s.selfId);
  const list = Object.values(players);

  if (list.length === 0) return <p>접속한 플레이어가 없습니다.</p>;

  return (
    <table className="mono">
      <thead>
        <tr><th>이름</th><th>x</th><th>y</th><th>z</th><th>rotY</th></tr>
      </thead>
      <tbody>
        {list.map((p) => (
          <tr key={p.id}>
            <td>
              <span style={{ color: p.color }}>●</span> {p.name}
              {p.id === selfId && " (나)"}
            </td>
            {p.p.map((v, i) => <td key={i}>{v.toFixed(2)}</td>)}
            <td>{p.r.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
