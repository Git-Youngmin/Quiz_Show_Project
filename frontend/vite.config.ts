import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 개발 중에는 /api 요청(WebSocket 포함)을 로컬 Node 백엔드(8787)로 프록시.
// → 브라우저는 같은 Origin 으로 접속하므로 CORS/포트 설정이 필요 없음.
export default defineConfig({
  plugins: [react()],
  build: {
    // 3D 청크(three/drei ≈ 0.95MB, rapier 는 wasm 을 base64 로 내장해 ≈ 2.3MB)는
    // /play·/display 진입 시에만 lazy 로드되므로 경고 기준을 그 크기에 맞춘다.
    // 첫 화면 엔트리 청크는 ~280kB.
    chunkSizeWarningLimit: 2500,
  },
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
