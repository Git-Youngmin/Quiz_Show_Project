import { Component, type ReactNode } from "react";

const RELOAD_FLAG = "quiz:chunk-reload-at";

function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return /dynamically imported module|Importing a module script failed|error loading dynamically|ChunkLoadError|Failed to fetch/i.test(
    msg,
  );
}

/**
 * 라우트 청크 로드 실패 대비. 재배포로 옛 해시 청크가 사라지면 lazy import 가 실패하는데,
 * 이때 한 번만 새로고침해 새 index.html(새 청크 목록)을 받는다. 반복 실패 시엔 안내 화면.
 */
export class ChunkErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    if (!isChunkLoadError(error)) return;
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(RELOAD_FLAG) ?? 0);
      // 10초 안에 이미 한 번 새로고침했다면 무한 루프 방지를 위해 멈춤
      if (Date.now() - last < 10_000) return;
      sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
    } catch {
      /* 저장소 차단 시에도 1회 새로고침은 시도 */
    }
    window.location.reload();
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="route-fallback" role="alert">
        <div style={{ textAlign: "center" }}>
          <p>화면을 불러오지 못했어요.</p>
          <button className="btn" type="button" onClick={() => window.location.reload()}>
            새로고침
          </button>
        </div>
      </div>
    );
  }
}
