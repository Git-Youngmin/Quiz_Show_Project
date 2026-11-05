/** 3D 월드 공용 상수 */
import { SPECTATOR_ZONE as SPECTATOR_ZONE_REF } from "@quiz/shared";

/** 퀴즈 보드(바닥) 크기 — 윗면이 y = 0 */
export const BOARD_SIZE = 30;
export const BOARD_THICKNESS = 1;

/** 캐릭터 캡슐: 반높이(원기둥 부분) + 반지름 → 전체 높이 = 2 * (HALF + RADIUS) = 1.6 */
export const CAPSULE_HALF_HEIGHT = 0.35;
export const CAPSULE_RADIUS = 0.45;
export const CHARACTER_CENTER_Y = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS;

export const MOVE_SPEED = 6; // units/s
export const JUMP_VELOCITY = 7;
/** 이 높이 아래로 떨어지면 리스폰 */
export const FALL_LIMIT_Y = -15;

/** 3인칭 카메라 오프셋 (캐릭터 기준) */
export const CAMERA_OFFSET: [number, number, number] = [0, 9, 13];

/** ── 탈락자 관전 구역 (위치/크기는 서버와 공유: @quiz/shared 의 SPECTATOR_ZONE) ── */
export { SPECTATOR_ZONE } from "@quiz/shared";

/**
 * 관전 구역 안 랜덤 리스폰 위치 — 투척 발판이 있는 앞쪽(보드 방향)을 피해 뒤쪽 2/3 에 생성
 * (리스폰하자마자 발판을 밟아 던지는 일이 없도록)
 */
export function randomSpectatorSpawn() {
  const [cx, cy, cz] = SPECTATOR_ZONE_REF.center;
  const [sx, sz] = SPECTATOR_ZONE_REF.size;
  const backX = cx - sx / 2 + 1.5; // 뒤쪽 벽 근처
  const frontX = cx + sx / 2 - 5; // 발판 줄 앞까지
  return {
    x: backX + Math.random() * (frontX - backX),
    y: cy + CHARACTER_CENTER_Y + 0.3,
    z: cz + (Math.random() - 0.5) * (sz - 3),
  };
}
