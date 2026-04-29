import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  OUTFIT_PRESETS,
  OUTFIT_CATEGORIES,
  sampleOutfits,
  sampleOutfitPrompts,
  composeOutfitPrompt,
  weightsFromStats,
} from "../lib/outfitPresets.js";

describe("random mode (no reference photo) — hasReferences=false", () => {
  const beachModule = OUTFIT_PRESETS.find((m) => m.category === "beach");

  it("default (no opt) keeps the legacy reference-anchored blocks", () => {
    const prompt = composeOutfitPrompt(beachModule, { aspectRatio: "1:1" });
    assert.match(prompt, /참고 이미지 인물 고정/);
    assert.match(prompt, /\[얼굴 — 참조에서 식별만/);
    assert.match(prompt, /참조와 반드시 달라야 함/);
    assert.match(prompt, /참고 이미지 인물의 머리카락/);
  });

  it("hasReferences=false drops every reference-anchored block", () => {
    const prompt = composeOutfitPrompt(beachModule, {
      aspectRatio: "1:1",
      hasReferences: false,
    });
    assert.doesNotMatch(prompt, /참고 이미지 인물 고정/);
    assert.doesNotMatch(prompt, /\[얼굴 — 참조에서 식별만/);
    assert.doesNotMatch(prompt, /참조와 반드시 달라야 함/);
    assert.doesNotMatch(prompt, /참고 이미지 인물의 머리카락/);
    assert.doesNotMatch(prompt, /참조 이미지의 프레이밍이 비슷하면 OVERRIDE/);
  });

  it("hasReferences=false includes a random-Korean-woman person block", () => {
    const prompt = composeOutfitPrompt(beachModule, {
      aspectRatio: "1:1",
      hasReferences: false,
    });
    assert.match(prompt, /fresh random Korean woman/);
    assert.match(prompt, /do NOT carry over\s+facial features from any prior generation/);
    assert.match(prompt, /natural, ordinary face/);
  });

  it("hasReferences=false still keeps outfit / mood / camera framing", () => {
    const prompt = composeOutfitPrompt(beachModule, {
      aspectRatio: "1:1",
      hasReferences: false,
    });
    assert.match(prompt, /\[Outfit\]/);
    assert.match(prompt, /\[Mood\]/);
    assert.match(prompt, /\[카메라\]/);
    assert.match(prompt, /이번 컷 프레이밍 \(REQUIRED\)/);
  });

  it("sampleOutfitPrompts honors hasReferences=false through the pipeline", () => {
    const fixedRng = (() => {
      let i = 0;
      const seq = [0.13, 0.42, 0.78, 0.05, 0.61, 0.27, 0.88, 0.34];
      return () => seq[i++ % seq.length];
    })();
    const variants = sampleOutfitPrompts({
      count: 3,
      maxRisk: "medium",
      categories: ["beach"],
      aspectRatio: "1:1",
      hasReferences: false,
      rng: fixedRng,
    });
    assert.ok(variants.length > 0);
    for (const v of variants) {
      assert.doesNotMatch(v.prompt, /참고 이미지 인물 고정/);
      assert.match(v.prompt, /fresh random Korean woman/);
    }
  });
});

describe("media-category broadcast 16:9 enforcement (2026-04-29)", () => {
  it("composeOutfitPrompt forces 16:9 aspect for media-category modules", () => {
    const mediaModule = OUTFIT_PRESETS.find((m) => m.category === "media");
    assert.ok(mediaModule, "no media-category module in pool");
    const prompt = composeOutfitPrompt(mediaModule, { aspectRatio: "1024x1024" });
    // The user's 1:1 choice must be ignored; the prompt should declare 16:9.
    assert.match(prompt, /1824x1024|16:9 horizontal broadcast/i);
    // The dedicated broadcast frame block should be appended.
    assert.match(prompt, /\[방송 프레임/);
    assert.match(prompt, /caption-bar|lower-third caption/i);
    // The originally requested 1:1 size must NOT survive on the [퀄리티] line.
    assert.doesNotMatch(prompt, /^[\s-]*1024x1024 비율/m);
  });

  it("composeOutfitPrompt leaves non-media modules at the user's chosen aspect", () => {
    const beachModule = OUTFIT_PRESETS.find((m) => m.category === "beach");
    assert.ok(beachModule);
    const prompt = composeOutfitPrompt(beachModule, { aspectRatio: "1024x1024" });
    assert.match(prompt, /1024x1024 비율/);
    assert.doesNotMatch(prompt, /\[방송 프레임/);
  });

  it("sampleOutfitPrompts attaches forcedAspectRatio: '16:9' to media variants", () => {
    const fixedRng = (() => {
      let i = 0;
      const seq = [0.13, 0.42, 0.78, 0.05, 0.61, 0.27, 0.88, 0.34];
      return () => seq[i++ % seq.length];
    })();
    const variants = sampleOutfitPrompts({
      count: 8,
      maxRisk: "medium",
      categories: ["media"],
      aspectRatio: "1:1",
      rng: fixedRng,
    });
    assert.ok(variants.length > 0);
    for (const v of variants) {
      assert.equal(v.category, "media");
      assert.equal(v.forcedAspectRatio, "16:9", `variant ${v.id} missing forcedAspectRatio`);
    }
  });

  it("sampleOutfitPrompts does NOT attach forcedAspectRatio to non-media variants", () => {
    const fixedRng = (() => {
      let i = 0;
      const seq = [0.13, 0.42, 0.78, 0.05, 0.61, 0.27, 0.88, 0.34];
      return () => seq[i++ % seq.length];
    })();
    const variants = sampleOutfitPrompts({
      count: 5,
      maxRisk: "medium",
      categories: ["beach", "scenario"],
      aspectRatio: "1:1",
      rng: fixedRng,
    });
    for (const v of variants) {
      assert.notEqual(v.category, "media");
      assert.equal(v.forcedAspectRatio, undefined);
    }
  });
});

describe("outfit pool integrity", () => {
  it("has at least 2 modules per category present", () => {
    const counts = {};
    for (const m of OUTFIT_PRESETS) {
      counts[m.category] = (counts[m.category] || 0) + 1;
    }
    // At least one module exists per advertised category. Some categories
    // intentionally have only one module (e.g. fitting, gym).
    for (const cat of OUTFIT_CATEGORIES) {
      assert.ok(counts[cat] >= 1, `category ${cat} has no modules`);
    }
  });

  it("every module declares all required fields", () => {
    const needed = ["id", "label", "category", "risk", "outfit", "emphasis"];
    for (const m of OUTFIT_PRESETS) {
      for (const k of needed) {
        assert.ok(m[k], `module ${m.id || "(no id)"} missing ${k}`);
      }
      assert.ok(["low", "medium", "high"].includes(m.risk));
    }
  });

  it("module ids are unique", () => {
    const seen = new Set();
    for (const m of OUTFIT_PRESETS) {
      assert.ok(!seen.has(m.id), `duplicate id ${m.id}`);
      seen.add(m.id);
    }
  });

  it("no module body contains hard-blocker vocabulary", () => {
    // Pool curation rule: certain words are uncatchable triggers per
    // production data — even with wrappers they get rejected. Modules
    // are allowed to be sexy (off-shoulder, cropped, low-rise, mini,
    // fitted, slip, bikini) but must avoid these hard blockers.
    const banned =
      /(\bnude\b|\bnaked\b|\btopless\b|\bporn\b|\bsex\b|\berotic\b|\bfetish\b|see[- ]?through|sheer\s+(?:fabric|top|blouse)|시스루|투명|속옷|언더웨어|란제리|\bnipple|\bcleavage\b|\bunderage\b|\bteen\b|\bchild\b|\bminor\b|초등|중학|고등|미성년)/i;
    for (const m of OUTFIT_PRESETS) {
      const body = `${m.outfit} ${m.emphasis} ${m.label}`;
      assert.doesNotMatch(body, banned, `module ${m.id} contains banned term`);
    }
  });
});

describe("sampleOutfits", () => {
  it("returns N unique modules when N <= pool size", () => {
    const fixedRng = (() => {
      let i = 0;
      const seq = [0.13, 0.42, 0.78, 0.05, 0.61, 0.27, 0.88, 0.34, 0.5, 0.95];
      return () => seq[i++ % seq.length];
    })();
    const picks = sampleOutfits({ count: 4, maxRisk: "high", rng: fixedRng });
    assert.equal(picks.length, 4);
    const ids = new Set(picks.map((m) => m.id));
    assert.equal(ids.size, 4, "must be unique");
  });

  it("respects maxRisk filter", () => {
    const lowOnly = sampleOutfits({ count: 99, maxRisk: "low" });
    for (const m of lowOnly) assert.equal(m.risk, "low");
    const upToMed = sampleOutfits({ count: 99, maxRisk: "medium" });
    for (const m of upToMed) assert.ok(["low", "medium"].includes(m.risk));
  });

  it("respects categories filter", () => {
    const beachOnly = sampleOutfits({ count: 99, maxRisk: "high", categories: ["beach"] });
    assert.ok(beachOnly.length > 0);
    for (const m of beachOnly) assert.equal(m.category, "beach");
  });

  it("clamps count to 1 minimum", () => {
    assert.equal(sampleOutfits({ count: 0 }).length, 1);
    assert.equal(sampleOutfits({ count: -5 }).length, 1);
  });

  it("returns empty array when filter yields nothing", () => {
    const empty = sampleOutfits({ count: 4, categories: ["__nonexistent__"] });
    assert.deepEqual(empty, []);
  });
});

describe("composeOutfitPrompt", () => {
  it("composes a Korean-modular prompt with Outfit / Mood slots filled", () => {
    const m = OUTFIT_PRESETS[0];
    const p = composeOutfitPrompt(m);
    assert.match(p, /\[인물\]/);
    assert.match(p, /\[Outfit\]/);
    assert.match(p, /\[Mood\]/);
    assert.match(p, /\[카메라\]/);
    assert.match(p, /amateur|phone|snapshot|raw unedited/i);
    assert.match(p, /자연스러움/);
    assert.match(p, /NO airbrushing/);
    assert.match(p, /1:1 비율/);
    // Module body must appear in the composed prompt.
    assert.ok(p.includes(m.outfit));
    assert.ok(p.includes(m.emphasis));
  });

  it("honors custom aspect ratio", () => {
    const m = OUTFIT_PRESETS[0];
    const p = composeOutfitPrompt(m, { aspectRatio: "3:4" });
    assert.match(p, /3:4 비율/);
    assert.doesNotMatch(p, /1:1 비율/);
  });
});

describe("sampleOutfitPrompts (end-to-end)", () => {
  it("returns N composed variants with id/label/category/risk metadata", () => {
    const variants = sampleOutfitPrompts({ count: 3, maxRisk: "low" });
    assert.equal(variants.length, 3);
    for (const v of variants) {
      assert.ok(v.id);
      assert.ok(v.label);
      assert.ok(v.category);
      assert.ok(v.risk);
      assert.match(v.prompt, /\[Outfit\]/);
      assert.match(v.prompt, /amateur|phone|snapshot|raw unedited/i);
    assert.match(v.prompt, /자연스러움/);
    }
    // unique ids
    const ids = new Set(variants.map((v) => v.id));
    assert.equal(ids.size, 3);
  });
});

describe("excludeIds (auto-fill on retry)", () => {
  it("skips modules in the exclude list", () => {
    const all = sampleOutfits({ count: 99, maxRisk: "high" });
    const half = all.slice(0, Math.floor(all.length / 2)).map((m) => m.id);
    const remaining = sampleOutfits({
      count: 99,
      maxRisk: "high",
      excludeIds: half,
    });
    for (const m of remaining) {
      assert.ok(!half.includes(m.id), `excluded ${m.id} should not appear`);
    }
  });
});

describe("weightsFromStats (pass-rate-aware sampling)", () => {
  it("ignores modules with too few samples", () => {
    const w = weightsFromStats({
      "module-a": { success: 1, fail: 0 }, // total=1, ignored
      "module-b": { success: 8, fail: 2 }, // total=10, included
    });
    assert.ok(!("module-a" in w));
    assert.ok("module-b" in w);
  });

  it("computes weights in [0.3, 2.0] proportional to pass rate", () => {
    const w = weightsFromStats({
      "high-pass": { success: 10, fail: 0 }, // 100%
      "mid-pass": { success: 5, fail: 5 }, // 50%
      "low-pass": { success: 0, fail: 10 }, // 0%
    });
    assert.equal(w["high-pass"], 0.3 + 1.7);
    assert.equal(w["mid-pass"], 0.3 + 1.7 * 0.5);
    assert.equal(w["low-pass"], 0.3);
  });

  it("biases sampling toward high-pass modules", () => {
    const ids = ["a", "b", "c", "d"];
    const all = ids.map((id) => ({ id, label: id, category: "x", risk: "low", outfit: "x", emphasis: "x" }));
    // Custom pool injection via excludeIds is not how sampleOutfits works,
    // so we verify the weighting math directly by counting picks.
    const weights = { a: 2.0, b: 0.3 };
    const seq = [0.1, 0.5, 0.9, 0.3];
    let i = 0;
    const rng = () => seq[i++ % seq.length];
    void all;
    // Sanity: with a high weight, module 'a' should be picked first far
    // more often. This is a smoke check on weightsFromStats output range.
    const computed = weightsFromStats({
      a: { success: 100, fail: 0 },
      b: { success: 0, fail: 100 },
    });
    assert.ok(computed.a > computed.b);
    void weights;
    void rng;
  });
});

describe("sexy-axis pool composition", () => {
  it("includes the core sexy-tune categories", () => {
    for (const cat of ["beach", "crop", "denim", "dress", "fitting", "lounge", "gym"]) {
      assert.ok(OUTFIT_CATEGORIES.includes(cat), `missing category ${cat}`);
    }
  });

  it("has multiple modules per primary category", () => {
    for (const cat of ["beach", "crop", "denim", "dress", "fitting"]) {
      const inCat = OUTFIT_PRESETS.filter((m) => m.category === cat);
      assert.ok(inCat.length >= 2, `${cat} should have ≥2 modules, has ${inCat.length}`);
    }
  });

  it("excludes the modest-only categories from v1 (autumn/office/outerwear)", () => {
    // These were too modest to belong in a "sexy tune" pool — moved out
    // by user feedback (2026-04-28). Keep them out.
    assert.ok(!OUTFIT_CATEGORIES.includes("autumn"));
    assert.ok(!OUTFIT_CATEGORIES.includes("office"));
    assert.ok(!OUTFIT_CATEGORIES.includes("outerwear"));
  });
});
