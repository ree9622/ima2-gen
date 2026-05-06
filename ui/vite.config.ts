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
        // 새 SW 즉시 활성화 + 모든 탭 점유 — 그렇지 않으면 사용자가 옛 dist
        // 를 한 번 더 새로고침 해야 새 코드를 받게 된다 (vite-plugin-pwa
        // autoUpdate 의 디폴트는 '활성화 시도' 일 뿐 강제 swap 은 안 함).
        skipWaiting: true,
        clientsClaim: true,
        // navigation 요청(/, /codex-router 등)은 NetworkFirst — 옛 index.html
        // 캐시 때문에 새 dist 자산 hash 가 안 갱신되어 ⚙ Codex 버튼처럼 새
        // 컴포넌트가 사라져 보이던 회귀 방지. 네트워크 3초 안에 응답이 오지
        // 않을 때만 캐시 폴백. precache 안 하므로 globPatterns 에 html 제외.
        globPatterns: ["**/*.{js,css,svg,ico,webmanifest}"],
        navigateFallback: undefined,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "ima2-html",
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 4, maxAgeSeconds: 24 * 60 * 60 },
            },
          },
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
          xyflow: ["@xyflow/react"],
        },
      },
    },
  },
});
