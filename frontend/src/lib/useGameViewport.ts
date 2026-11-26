import { useEffect } from "react";

const GAME_VIEWPORT = "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover";

/**
 * 3D 게임 화면(/play, /display)에서만 핀치 확대를 막는다.
 * 조이스틱·점프 버튼을 누르다 화면이 확대되는 것을 방지하고, 다른 페이지(로비·관리자)에서는
 * 확대가 가능하도록 화면을 떠날 때 원래 viewport 로 되돌린다.
 */
export function useGameViewport() {
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta) return;
    const prev = meta.content;
    meta.content = GAME_VIEWPORT;
    return () => {
      meta.content = prev;
    };
  }, []);
}
