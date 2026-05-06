import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["favicon.ico"],
      manifest: {
        name: "ima2-gen",
        short_name: "ima2",
        description: "GPT 이미지 생성기",
        theme_color: "#0a0a0a",
        background_color: "#0a0a0a",
        display: "standalone",
        start_url: "/",
        icons: [],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,ico}"],
        // .thumbs/ 변형은 immutable + content-addressed 라 cache-first 가
        // 이상적. 한 번 본 썸네일은 영구 캐시 (max 30 일, 2000개) 까지
        // 네트워크 미접속에도 즉시 표시.
        runtimeCaching: [
          {
            urlPattern: /\/generated\/\.thumbs\//,
            handler: "CacheFirst",
            options: {
              cacheName: "ima2-thumbs",
              expiration: {
                maxEntries: 2000,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3333",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // @xyflow/react 는 노드 캔버스에서만 사용 — 메인 진입 chunk 에서
          // 분리해 reactflow 런타임을 노드 모드 첫 진입 시점까지 미룬다.
          xyflow: ["@xyflow/react"],
        },
      },
    },
  },
});
