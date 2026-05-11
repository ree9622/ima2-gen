import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

test("toast notifications render as a dismissible bottom-right stack", () => {
  const store = readFileSync("ui/src/store/useAppStore.ts", "utf8");
  const component = readFileSync("ui/src/components/Toast.tsx", "utf8");
  const css = readFileSync("ui/src/index.css", "utf8");

  assert.match(store, /type ToastEntry = \{ message: string; error: boolean; id: number; createdAt: number \}/);
  assert.match(store, /toastLog: ToastEntry\[\]/);
  assert.match(store, /dismissToast: \(id: number\) => void/);
  assert.match(store, /toastLog: next\.slice\(-TOAST_STACK_LIMIT\)/);

  assert.match(component, /const toastLog = useAppStore\(\(s\) => s\.toastLog\)/);
  assert.match(component, /dismissToast/);
  assert.match(component, /toast-stack/);
  assert.match(component, /aria-label="알림 닫기"/);

  assert.match(css, /\.toast-stack\s*\{/);
  assert.match(css, /flex-direction:\s*column/);
  assert.match(css, /\.toast__dismiss/);
});
