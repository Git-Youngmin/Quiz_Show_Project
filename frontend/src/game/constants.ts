/** 3D 월드 공용 상수 */

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

/** ── 탈락자 관전 구역 (보드 왼쪽 바깥, 살짝 높은 유리 상자) ── */
export const SPECTATOR_ZONE = {
  center: [-27, 3, 0] as [number, number, number], // 발판 윗면 중심 (y = 윗면 높이)
  size: [10, 16] as [number, number], // x, z 크기
  wallHeight: 4, // 점프 최고점(약 2.5) 보다 높게
  ceilingHeight: 5.5, // 천장 콜라이더로 완전히 밀폐
};

/** 관전 구역 안 랜덤 리스폰 위치 */
export function randomSpectatorSpawn() {
  const [cx, cy, cz] = SPECTATOR_ZONE.center;
  const [sx, sz] = SPECTATOR_ZONE.size;
  return {
    x: cx + (Math.random() - 0.5) * (sx - 3),
    y: cy + CHARACTER_CENTER_Y + 0.3,
    z: cz + (Math.random() - 0.5) * (sz - 3),
  };
}
