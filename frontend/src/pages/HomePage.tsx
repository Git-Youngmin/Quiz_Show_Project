import { useState } from "react";
import { Link } from "react-router-dom";
import { DEFAULT_ROOM } from "../lib/useRoomConnection";

export default function HomePage() {
  const [room, setRoom] = useState(DEFAULT_ROOM);
  const [name, setName] = useState("");
  const q = (extra: Record<string, string> = {}) =>
    `?${new URLSearchParams({ room, ...extra })}`;

  return (
    <div className="page">
      <h1>Quiz Show</h1>
      <div className="card">
        <div className="row">
          <input className="input" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="방 코드" />
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="닉네임" maxLength={16} />
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <Link className="btn" to={`/play${q(name ? { name } : {})}`}>참가하기 (/play)</Link>
          <Link className="btn" to={`/admin${q()}`}>관리자 (/admin)</Link>
          <Link className="btn" to={`/display${q()}`}>송출 화면 (/display)</Link>
        </div>
      </div>
    </div>
  );
}
