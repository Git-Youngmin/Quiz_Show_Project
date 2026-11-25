import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import HomePage from "./pages/HomePage";
import { ChunkErrorBoundary } from "./components/ChunkErrorBoundary";
import { loadPlayPage, loadDisplayPage } from "./lib/routeChunks";

// 로비(/)는 즉시 로드하고, 무거운 3D 화면(three / rapier / drei)과 관리자 화면은
// 라우트별 청크로 분리해 필요할 때만 내려받는다.
const AdminPage = lazy(() => import("./pages/AdminPage"));
const PlayPage = lazy(loadPlayPage);
const DisplayPage = lazy(loadDisplayPage);

function RouteFallback() {
  return (
    <div className="route-fallback" role="status" aria-live="polite">
      불러오는 중…
    </div>
  );
}

export default function App() {
  return (
    <ChunkErrorBoundary>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/play" element={<PlayPage />} />
          <Route path="/display" element={<DisplayPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ChunkErrorBoundary>
  );
}
