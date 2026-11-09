import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  CHARACTER_COLORS,
  ANIMAL_CHARACTERS,
  LEGACY_SHAPES,
  CHARACTER_ACCESSORIES,
  MAX_NAME_LENGTH,
  type CharacterShape,
  type CharacterAccessory,
  type LobbySpot,
} from "@quiz/shared";
import { AvatarPreview } from "../components/AvatarPreview";
import { loadProfile, playSearch, saveProfile, type Profile } from "../lib/profile";
import { useGameStore } from "../store/useGameStore";

const CHARACTER_META: Record<CharacterShape, { label: string; icon: string }> = {
  cat: { label: "고양이", icon: "🐱" },
  dog: { label: "강아지", icon: "🐶" },
  rabbit: { label: "토끼", icon: "🐰" },
  bear: { label: "곰", icon: "🐻" },
  panda: { label: "팬더", icon: "🐼" },
  fox: { label: "여우", icon: "🦊" },
  frog: { label: "개구리", icon: "🐸" },
  penguin: { label: "펭귄", icon: "🐧" },
  duck: { label: "오리", icon: "🦆" },
  pig: { label: "돼지", icon: "🐷" },
  monkey: { label: "원숭이", icon: "🐵" },
  koala: { label: "코알라", icon: "🐨" },
  hamster: { label: "햄스터", icon: "🐹" },
  chick: { label: "병아리", icon: "🐥" },
  tiger: { label: "호랑이", icon: "🐯" },
  lion: { label: "사자", icon: "🦁" },
  dragon: { label: "드래곤", icon: "🐲" },
  robot: { label: "로봇", icon: "🤖" },
  alien: { label: "외계인", icon: "👽" },
  ghost: { label: "유령", icon: "👻" },
  // 레거시 형태
  capsule: { label: "캡슐", icon: "💊" },
  box: { label: "박스", icon: "📦" },
  sphere: { label: "구", icon: "⚽" },
  cone: { label: "콘", icon: "📐" },
};

const ACCESSORY_META: Record<CharacterAccessory, { label: string; icon: string }> = {
  none: { label: "없음", icon: "❌" },
  crown: { label: "왕관", icon: "👑" },
  party_hat: { label: "파티모자", icon: "🥳" },
  headphones: { label: "헤드폰", icon: "🎧" },
  cap: { label: "스냅백", icon: "🧢" },
  halo: { label: "천사링", icon: "😇" },
  ribbon: { label: "리본", icon: "🎀" },
  sunglasses: { label: "선글라스", icon: "😎" },
  glasses: { label: "안경", icon: "👓" },
};

const ROOM_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
type CustomTab = "character" | "accessory" | "color";

/**
 * 로비 — 닉네임 / 방 코드 / 20종 캐릭터 & 꾸미기 악세사리 & 색상 선택 후 입장.
 */
export default function HomePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const initial = useMemo<Profile>(() => {
    const saved = loadProfile();
    const room = params.get("room");
    return room ? { ...saved, roomId: room } : saved;
  }, [params]);

  const [name, setName] = useState(initial.name);
  const [roomId, setRoomId] = useState(initial.roomId);
  const [shape, setShape] = useState<CharacterShape>(initial.shape);
  const [accessory, setAccessory] = useState<CharacterAccessory>(initial.accessory ?? "none");
  const [color, setColor] = useState(initial.color);
  const [spot, setSpot] = useState<LobbySpot>(initial.spot);
  const [activeTab, setActiveTab] = useState<CustomTab>("character");

  const trimmedName = name.trim();
  const roomValid = ROOM_PATTERN.test(roomId);
  const canEnter = trimmedName.length > 0 && roomValid;

  const enter = (e: FormEvent) => {
    e.preventDefault();
    if (!canEnter) return;
    const profile: Profile = { name: trimmedName, roomId, shape, accessory, color, spot };
    saveProfile(profile);
    useGameStore.getState().setLobbySpot(spot);
    useGameStore.getState().connect({ roomId, role: "player", name: trimmedName, shape, accessory, color });
    navigate(`/play${playSearch(profile)}`);
  };

  return (
    <div className="lobby">
      <form className="lobby-card" onSubmit={enter}>
        <header className="lobby-header">
          <h1>Quiz Show</h1>
          <p>카훗풍 3D 퀴즈 서바이벌 — 마지막까지 살아남으세요!</p>
        </header>

        <div className="lobby-grid">
          {/* 3D 캐릭터 실시간 회전 미리보기 */}
          <div className="lobby-preview">
            <AvatarPreview shape={shape} accessory={accessory} color={color} size={140} />
            <div className="nameplate self lobby-nameplate">{trimmedName || "내 캐릭터"}</div>
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

        {/* 커스터마이징 탭 */}
        <fieldset className="picker">
          <div className="character-tabs" role="tablist">
            <button
              type="button"
              className={`character-tab ${activeTab === "character" ? "active" : ""}`}
              onClick={() => setActiveTab("character")}
            >
              🎭 캐릭터 (20종)
            </button>
            <button
              type="button"
              className={`character-tab ${activeTab === "accessory" ? "active" : ""}`}
              onClick={() => setActiveTab("accessory")}
            >
              👑 꾸미기 ({ACCESSORY_META[accessory]?.label ?? "없음"})
            </button>
            <button
              type="button"
              className={`character-tab ${activeTab === "color" ? "active" : ""}`}
              onClick={() => setActiveTab("color")}
            >
              🎨 색상
            </button>
          </div>

          {/* 1. 캐릭터 선택 패널 */}
          {activeTab === "character" && (
            <div className="character-grid-20">
              {ANIMAL_CHARACTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`character-card ${shape === s ? "selected" : ""}`}
                  aria-pressed={shape === s}
                  onClick={() => setShape(s)}
                >
                  <span className="character-card-icon">{CHARACTER_META[s].icon}</span>
                  <span className="character-card-name">{CHARACTER_META[s].label}</span>
                </button>
              ))}
              {LEGACY_SHAPES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`character-card ${shape === s ? "selected" : ""}`}
                  aria-pressed={shape === s}
                  onClick={() => setShape(s)}
                >
                  <span className="character-card-icon">{CHARACTER_META[s].icon}</span>
                  <span className="character-card-name">{CHARACTER_META[s].label}</span>
                </button>
              ))}
            </div>
          )}

          {/* 2. 꾸미기 악세사리 패널 */}
          {activeTab === "accessory" && (
            <div className="accessory-grid">
              {CHARACTER_ACCESSORIES.map((acc) => (
                <button
                  key={acc}
                  type="button"
                  className={`accessory-card ${accessory === acc ? "selected" : ""}`}
                  aria-pressed={accessory === acc}
                  onClick={() => setAccessory(acc)}
                >
                  <span className="accessory-card-icon">{ACCESSORY_META[acc].icon}</span>
                  <span className="accessory-card-name">{ACCESSORY_META[acc].label}</span>
                </button>
              ))}
            </div>
          )}

          {/* 3. 색상 선택 패널 */}
          {activeTab === "color" && (
            <div className="color-grid-new">
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
          )}
        </fieldset>

        {/* 입장 위치 */}
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
