import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 개발 중에는 /api 요청(WebSocket 포함)을 로컬 Node 백엔드(8787)로 프록시.
// → 브라우저는 같은 Origin 으로 접속하므로 CORS/포트 설정이 필요 없음.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // 같은 Wi-Fi 의 휴대폰에서 /play 접속 테스트 가능
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
