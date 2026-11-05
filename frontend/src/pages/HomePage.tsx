import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CHARACTER_COLORS, CHARACTER_SHAPES, MAX_NAME_LENGTH, type CharacterShape, type LobbySpot } from "@quiz/shared";
import { AvatarPreview } from "../components/AvatarPreview";
import { loadProfile, playSearch, saveProfile, type Profile } from "../lib/profile";
import { useGameStore } from "../store/useGameStore";

const SHAPE_LABEL: Record<CharacterShape, string> = {
  capsule: "캡슐",
  box: "박스",
  sphere: "구",
  cone: "콘",
};
const ROOM_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * 로비 — 닉네임 / 방 코드 / 캐릭터 모양·색상을 고르고 입장.
 * 입장하면 스토어로 WebSocket 접속을 시작한 뒤 /play 로 이동한다.
 * (/play 의 useRoomConnection 은 같은 옵션이면 중복 접속하지 않음)
 */
export default function HomePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // 공유 링크(/?room=abc)로 들어오면 방 코드를 미리 채움
  const initial = useMemo<Profile>(() => {
    const saved = loadProfile();
    const room = params.get("room");
    return room ? { ...saved, roomId: room } : saved;
  }, [params]);

  const [name, setName] = useState(initial.name);
  const [roomId, setRoomId] = useState(initial.roomId);
  const [shape, setShape] = useState<CharacterShape>(initial.shape);
  const [color, setColor] = useState(initial.color);
  const [spot, setSpot] = useState<LobbySpot>(initial.spot);

  const trimmedName = name.trim();
  const roomValid = ROOM_PATTERN.test(roomId);
  const canEnter = trimmedName.length > 0 && roomValid;

  const enter = (e: FormEvent) => {
    e.preventDefault();
    if (!canEnter) return;
    const profile: Profile = { name: trimmedName, roomId, shape, color, spot };
    saveProfile(profile);
    useGameStore.getState().setLobbySpot(spot);
    useGameStore.getState().connect({ roomId, role: "player", name: trimmedName, shape, color });
    navigate(`/play${playSearch(profile)}`);
  };

  return (
    <div className="lobby">
      <form className="lobby-card" onSubmit={enter}>
        <header className="lobby-header">
          <h1>Quiz Show</h1>
          <p>O / X 퀴즈 서바이벌 — 마지막까지 살아남으세요!</p>
        </header>

        <div className="lobby-grid">
          {/* 미리보기 */}
          <div className="lobby-preview">
            <AvatarPreview shape={shape} color={color} size={140} />
            <div className="nameplate self lobby-nameplate">{trimmedName || "닉네임"}</div>
          </div>

          <div className="lobby-fields">
            <label className="field">
              <span>닉네임</span>
              <input
                className="input"
                value={name}
                maxLength={MAX_NAME_LENGTH}
                placeholder="최대 16자"
                autoComplete="nickname"
                onChange={(e) => setName(e.target.value)}
                autoFocus={!initial.name}
              />
            </label>
            <label className="field">
              <span>방 코드</span>
              <input
                className="input mono"
                value={roomId}
                maxLength={32}
                placeholder="예) lobby"
                autoCapitalize="off"
                onChange={(e) => setRoomId(e.target.value.trim())}
                aria-invalid={!roomValid}
              />
              {!roomValid && roomId && <small className="field-error">영문, 숫자, -, _ 만 쓸 수 있어요</small>}
            </label>
          </div>
        </div>

        <fieldset className="picker">
          <legend>모양</legend>
          <div className="shape-grid">
            {CHARACTER_SHAPES.map((s) => (
              <button
                key={s}
                type="button"
                className={`shape-option ${shape === s ? "selected" : ""}`}
                aria-pressed={shape === s}
                onClick={() => setShape(s)}
              >
                <AvatarPreview shape={s} color={color} size={48} />
                <span>{SHAPE_LABEL[s]}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="picker">
          <legend>색상</legend>
          <div className="color-grid">
            {CHARACTER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`color-swatch ${color === c ? "selected" : ""}`}
                style={{ background: c }}
                aria-label={`색상 ${c}`}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </fieldset>

        <fieldset className="picker">
          <legend>입장 위치</legend>
          <div className="spot-grid">
            {(
              [
                ["board", "🟦 퀴즈 보드", "생존자 자리 · 바로 퀴즈에 참가할 준비"],
                ["stand", "🏟 관전석", "버튼을 밟아 보드 위 사람들에게 방해물 던지며 놀기"],
              ] as const
            ).map(([value, title, desc]) => (
              <button
                key={value}
                type="button"
                className={`spot-option ${spot === value ? "selected" : ""}`}
                aria-pressed={spot === value}
                onClick={() => setSpot(value)}
              >
                <b>{title}</b>
                <span>{desc}</span>
              </button>
            ))}
          </div>
          <small className="spot-note">어디서 기다리든 게임이 시작되면 모두 보드로 이동해 참가해요.</small>
        </fieldset>

        <button className="btn lobby-enter" type="submit" disabled={!canEnter}>
          입장하기
        </button>

        <nav className="lobby-links">
          <Link to={`/admin?room=${encodeURIComponent(roomId)}`}>관리자 패널</Link>
          <span>·</span>
          <Link to={`/display?room=${encodeURIComponent(roomId)}`}>송출 화면</Link>
        </nav>
      </form>
    </div>
  );
}
