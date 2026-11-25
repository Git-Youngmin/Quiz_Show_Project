// 라우트 청크 로더. 같은 import() 를 재사용하면 브라우저가 한 번만 내려받으므로
// 로비에서 미리 받아둔(prefetch) 청크를 /play 진입 시 그대로 쓴다.
export const loadPlayPage = () => import("../pages/PlayPage");
export const loadDisplayPage = () => import("../pages/DisplayPage");

/** 브라우저가 한가할 때 /play 청크를 미리 받아 입장 대기 시간을 줄인다. */
export function prefetchPlayPage(): () => void {
  const run = () => {
    void loadPlayPage().catch(() => {
      /* 오프라인 등 – 실제 이동 시 다시 시도됨 */
    });
  };
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(run, { timeout: 4000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, 1500);
  return () => window.clearTimeout(id);
}
