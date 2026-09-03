import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const loginSource = readFileSync(
  new URL("../ui/src/components/LoginPage.tsx", import.meta.url),
  "utf8",
);
const robots = readFileSync(
  new URL("../ui/public/robots.txt", import.meta.url),
  "utf8",
);

test("login page identifies the private service and gives safe credential guidance", () => {
  assert.match(loginSource, /SamLab 내부 이미지 생성기/);
  assert.match(loginSource, /images\.samlab\.click/);
  assert.match(loginSource, /이 서비스 전용 계정/);
  assert.match(loginSource, /다른 서비스에서 사용하는 비밀번호를 재사용하지 마세요/);
  assert.doesNotMatch(loginSource, /ima2-user add|\(CLI:/);
});

test("robots.txt blocks indexing of every route", () => {
  assert.strictEqual(
    robots.replace(/\r\n/g, "\n"),
    "User-agent: *\nDisallow: /\n",
  );
});
