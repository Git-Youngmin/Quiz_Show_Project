import { BOARD_SIZE, ZONES, type Answer, type QuizType } from "@quiz/shared";

/** 타일 사이 틈 (캐릭터 지름 0.9 보다 훨씬 작아서 빠지지 않음, 차단벽이 이 틈으로 솟아오름) */
export const TILE_GAP = 0.2;

/** 구역별 색상과 바닥 마크 (4지선다는 퀴즈쇼에서 익숙한 도형+색 조합) */
export const ZONE_STYLE: Record<Answer, { color: string; mark: "ring" | "cross" | "triangle" | "diamond" | "circle" | "square" }> = {
  O: { color: "#4d8bff", mark: "ring" },
  X: { color: "#ff5c6c", mark: "cross" },
  A: { color: "#ff5c6c", mark: "triangle" },
  B: { color: "#4d8bff", mark: "diamond" },
  C: { color: "#f5a524", mark: "circle" },
  D: { color: "#3fbf6f", mark: "square" },
};

export interface TileLayout {
  zone: Answer;
  /** 타일 중심 */
  cx: number;
  cz: number;
  /** 크기 (x, z) */
  w: number;
  d: number;
  /** 바깥 방향 (낙하 시 이 방향으로 기울어짐). OX 는 sz = 0 */
  sx: -1 | 1;
  sz: -1 | 0 | 1;
}

/**
 * 퀴즈 유형별 바닥 타일 배치 (서버의 zoneAt() 과 동일한 규칙)
 *  OX       : O 왼쪽 | X 오른쪽
 *  MULTIPLE : A 좌상(-x,-z) · B 우상(+x,-z) · C 좌하(-x,+z) · D 우하(+x,+z)
 */
export function tileLayouts(type: QuizType): TileLayout[] {
  const half = BOARD_SIZE / 2;
  const size = half - TILE_GAP / 2;
  const off = TILE_GAP / 2 + size / 2;
  if (type === "OX") {
    return [
      { zone: "O", cx: -off, cz: 0, w: size, d: BOARD_SIZE, sx: -1, sz: 0 },
      { zone: "X", cx: off, cz: 0, w: size, d: BOARD_SIZE, sx: 1, sz: 0 },
    ];
  }
  const signs: Record<string, [-1 | 1, -1 | 1]> = { A: [-1, -1], B: [1, -1], C: [-1, 1], D: [1, 1] };
  return ZONES.MULTIPLE.map((zone) => {
    const [sx, sz] = signs[zone];
    return { zone, cx: sx * off, cz: sz * off, w: size, d: size, sx, sz };
  });
}

/** 여러 구역의 중심 (카메라 연출용) */
export function zonesCenter(type: QuizType, zones: readonly Answer[]): [number, number] {
  const tiles = tileLayouts(type).filter((t) => zones.includes(t.zone));
  if (tiles.length === 0) return [0, 0];
  return [
    tiles.reduce((a, t) => a + t.cx, 0) / tiles.length,
    tiles.reduce((a, t) => a + t.cz, 0) / tiles.length,
  ];
}
