import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const settings = readFileSync(join(root, "ui/src/components/SettingsWorkspace.tsx"), "utf8");
const mobileToggle = readFileSync(join(root, "ui/src/components/MobileSettingsToggle.tsx"), "utf8");
const css = readFileSync(join(root, "ui/src/index.css"), "utf8");
const settingsControlsCss = readFileSync(join(root, "ui/src/styles/settings-controls.css"), "utf8");

test("settings workspace keeps mobile and desktop navigation from occupying the same grid", () => {
  assert.match(settings, /settings-nav settings-nav--mobile/);
  assert.match(settings, /settings-mobile-nav/);
  assert.match(settings, /settings-mobile-nav__item/);
  assert.match(settings, /aria-current=\{active === section \? "true" : undefined\}/);
  assert.doesNotMatch(settings, /<select[\s\S]*?settings\.navAria/);
  assert.match(settings, /<nav className="settings-nav"/);
  assert.match(css, /\.settings-nav--mobile\s*\{[\s\S]*?display:\s*none;/);
  assert.match(css, /@media \(max-width:\s*800px\)[\s\S]*?\.settings-nav--mobile\s*\{[\s\S]*?display:\s*block;/);
  assert.match(
    css,
    /@media \(max-width:\s*800px\)[\s\S]*?\.settings-layout > \.settings-nav:not\(\.settings-nav--mobile\)\s*\{[\s\S]*?display:\s*none;/,
  );
  assert.match(css, /@media \(max-width:\s*600px\)[\s\S]*?\.settings-mobile-nav\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /@media \(max-width:\s*600px\)[\s\S]*?\.settings-workspace\s*\{[\s\S]*?padding:\s*0;/);
  assert.match(css, /@media \(max-width:\s*600px\)[\s\S]*?\.settings-row\s*\{[\s\S]*?gap:\s*12px;/);
  assert.match(css, /@media \(max-width:\s*600px\)[\s\S]*?\.settings-row__control > \*/);
  assert.match(css, /\.settings-mobile-nav__item\s*\{[\s\S]*?min-height:\s*44px;/);
  assert.match(css, /@media \(max-width:\s*800px\)[\s\S]*?\.app\.app--settings-open\s*\{[\s\S]*?height:\s*100dvh;[\s\S]*?overflow:\s*hidden;/);
  assert.match(css, /@media \(max-width:\s*800px\)[\s\S]*?\.app\.app--settings-open \.sidebar,[\s\S]*?\.app\.app--settings-open \.history-strip\s*\{[\s\S]*?display:\s*none;/);
  assert.match(mobileToggle, /openComposeSheet\("controls"\)/);
});

test("desktop settings rows use a compact title-control-description stack", () => {
  assert.match(
    css,
    /\.settings-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/,
  );
  assert.match(css, /\.settings-section__body\s*\{[\s\S]*?max-width:\s*none;/);
  assert.match(css, /\.settings-row__copy\s*\{[\s\S]*?display:\s*contents;/);
  assert.match(css, /\.settings-row h4,[\s\S]*?\.settings-note h4\s*\{[\s\S]*?order:\s*1;/);
  assert.match(css, /\.settings-row__control\s*\{[\s\S]*?order:\s*2;/);
  assert.match(css, /\.settings-row p,[\s\S]*?\.settings-note p\s*\{[\s\S]*?order:\s*3;/);
  assert.match(css, /\.settings-row p,[\s\S]*?\.settings-note p\s*\{[\s\S]*?max-width:\s*none;/);
  assert.match(settingsControlsCss, /\.settings-workspace \.settings-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  assert.doesNotMatch(settingsControlsCss, /minmax\(260px,\s*min\(360px,\s*46%\)\)/);
  assert.match(css, /\.settings-row__control > \*\s*\{[\s\S]*?width:\s*100%;/);
  assert.match(css, /\.settings-row__control > \.lang-toggle,[\s\S]*?\.settings-row__control > \.history-layout-toggle,[\s\S]*?\.settings-row__control > \.web-search-toggle\s*\{[\s\S]*?width:\s*fit-content;/);
  assert.match(css, /\.image-model-select--settings select\s*\{[\s\S]*?width:\s*100%;/);
});

test("workspace profile settings use a dropdown followed by selected-profile help", () => {
  const workspaceSettings = readFileSync(join(root, "ui/src/components/settings/WorkspaceProfileSettings.tsx"), "utf8");

  assert.match(workspaceSettings, /<select[\s\S]*id="workspace-profile-select"/);
  assert.match(workspaceSettings, /onChange=\{\(event\) => setProfile\(event\.target\.value as WorkspaceProfile\)\}/);
  assert.match(workspaceSettings, /aria-label=\{t\("workspace\.profileLabel"\)\}/);
  assert.doesNotMatch(workspaceSettings, /type="radio"/);
  assert.doesNotMatch(workspaceSettings, /settings-radio-option/);
  assert.doesNotMatch(workspaceSettings, /settings-field__label/);
  assert.doesNotMatch(workspaceSettings, /settings-field__description/);
  assert.match(css, /\.settings-field__select\s*\{[\s\S]*?min-height:\s*34px;/);
});
