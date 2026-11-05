import { Navigate, Route, Routes } from "react-router-dom";
import AdminPage from "./pages/AdminPage";
import DisplayPage from "./pages/DisplayPage";
import HomePage from "./pages/HomePage";
import PlayPage from "./pages/PlayPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/play" element={<PlayPage />} />
      <Route path="/display" element={<DisplayPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
