import {
  CHARACTER_COLORS,
  isCharacterColor,
  isCharacterShape,
  isCharacterAccessory,
  type CharacterShape,
  type CharacterAccessory,
  type LobbySpot,
} from "@quiz/shared";

/** 로비에서 고른 내 캐릭터 정보 (다음 방문 때 그대로 복원) */
export interface Profile {
  name: string;
  roomId: string;
  shape: CharacterShape;
  accessory: CharacterAccessory;
  color: string;
  /** 입장 위치: 퀴즈 보드(생존자 자리) / 관전석 */
  spot: LobbySpot;
}

const KEY = "quiz-show:profile";

export const DEFAULT_PROFILE: Profile = {
  name: "",
  roomId: "lobby",
  shape: "cat",
  accessory: "none",
  color: CHARACTER_COLORS[0],
  spot: "board",
};

/** localStorage 는 사생활 보호 모드 등에서 실패할 수 있으므로 항상 try/catch */
export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PROFILE;
    const p = JSON.parse(raw) as Partial<Profile>;
    return {
      name: typeof p.name === "string" ? p.name : "",
      roomId: typeof p.roomId === "string" && p.roomId ? p.roomId : DEFAULT_PROFILE.roomId,
      shape: isCharacterShape(p.shape) ? p.shape : DEFAULT_PROFILE.shape,
      accessory: isCharacterAccessory(p.accessory) ? p.accessory : DEFAULT_PROFILE.accessory,
      color: isCharacterColor(p.color) ? p.color : DEFAULT_PROFILE.color,
      spot: p.spot === "stand" ? "stand" : "board",
    };
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* 저장 실패는 무시 (다음 방문 때 기본값) */
  }
}

/** /play URL 쿼리 (새로고침해도 같은 캐릭터로 재접속되도록 외형까지 담음) */
export function playSearch(p: Profile): string {
  return `?${new URLSearchParams({
    room: p.roomId,
    name: p.name,
    shape: p.shape,
    accessory: p.accessory,
    color: p.color,
    spot: p.spot,
  })}`;
}
