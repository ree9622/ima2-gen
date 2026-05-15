import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function readSource(path) {
  return readFileSync(path, "utf-8");
}

describe("CLI doctor/status hardening contract", () => {
  it("surfaces generated dir, advertised server, skill integrity, and native binding health", () => {
    const ima2 = readSource("bin/ima2.ts");
    const doctor = readSource("bin/lib/doctor-checks.ts");

    assert.match(ima2, /Generated dir:/);
    assert.match(ima2, /Advertised server:/);
    assert.match(ima2, /buildHardeningDoctorLines/);
    assert.match(doctor, /Preferred backend port/);
    assert.match(doctor, /Card News:/);
    assert.match(doctor, /packaged skill/);
    assert.match(doctor, /better-sqlite3 native binding/);
    assert.match(doctor, /chmod 600/);
  });
});
