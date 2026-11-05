import type { KeyboardEvent, MouseEvent } from "react";

/**
 * 3D 게임 화면(.stage) 위 버튼들이 키보드 포커스를 가져가지 않게 하는 이벤트 핸들러 묶음.
 *
 * 버튼을 클릭하면 브라우저가 그 버튼에 포커스를 남기고, 이후 Space(점프)를 누르면
 * 그 버튼이 다시 "클릭"된다 → 관전석 버튼이 보드로 바뀌거나, 음소거가 토글되는 버그.
 *  - 클릭 직후 포커스 해제
 *  - 포커스된 버튼에서 Space/Enter 기본 동작(클릭) 차단 → 게임 조작으로만 쓰이게
 *
 * 사용: <div className="stage" {...stageButtonGuard}>
 */
export const stageButtonGuard = {
  onClickCapture(e: MouseEvent<HTMLElement>) {
    const btn = (e.target as HTMLElement).closest("button");
    // 클릭 핸들러(확인창 등)가 끝난 뒤에 포커스 해제
    if (btn) setTimeout(() => btn.blur(), 0);
  },
  onKeyDownCapture(e: KeyboardEvent<HTMLElement>) {
    if ((e.code === "Space" || e.key === "Enter") && (e.target as HTMLElement).closest("button")) {
      e.preventDefault();
      (e.target as HTMLElement).blur();
    }
  },
};
