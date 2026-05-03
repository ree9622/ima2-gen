// GitHub prompt import (Phase 6.3 fork extension).
//
// 입력: 사용자가 붙여넣은 GitHub URL.
// 동작: github.com/{user}/{repo}/blob/{ref}/{path} 형태를
//       raw.githubusercontent.com/{user}/{repo}/{ref}/{path} 로 변환,
//       텍스트를 받아와 fenced code block (``` ... ```) 단위로 분리.
//       각 블록 직전 markdown heading (### / ## / #) 을 title 로 채택.
//
// 일부러 외부 라이브러리 의존 없음 — fetch + 정규식만. 결과는 caller 가
// promptStore.createPrompt 로 한 건씩 저장하면 끝.
//
// upstream 51eb2bc / 6bcd902 의 GitHub discovery 흐름 참고 — 거기는
// React 모달 안에서 GitHub Search API 까지 도는데, fork 는 사용자가 URL
// 직접 붙여넣는 단순화 버전.

const RAW_HOST = 'raw.githubusercontent.com';
const ALLOWED_HOSTS = new Set(['github.com', 'raw.githubusercontent.com']);
const MAX_FETCH_BYTES = 512 * 1024;
const MAX_PROMPTS_PER_IMPORT = 200;
const MIN_BODY_LEN = 10;

export class PromptImportError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function toRawUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new PromptImportError('INVALID_URL', '올바른 URL이 아닙니다.');
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new PromptImportError('HOST_NOT_ALLOWED', 'github.com 또는 raw.githubusercontent.com URL만 허용합니다.');
  }
  if (url.hostname === 'raw.githubusercontent.com') {
    return url.toString();
  }
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 5 || parts[2] !== 'blob') {
    throw new PromptImportError(
      'URL_SHAPE',
      'github.com/{user}/{repo}/blob/{branch}/{path} 형식이 필요합니다.',
    );
  }
  const [user, repo, , ref, ...rest] = parts;
  return `https://${RAW_HOST}/${user}/${repo}/${ref}/${rest.join('/')}`;
}

async function fetchText(url) {
  let res;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'ima2-gen-prompt-import/1.0', Accept: 'text/plain, text/markdown, */*' },
    });
  } catch (e) {
    throw new PromptImportError('FETCH_FAILED', `URL을 가져오지 못했습니다: ${e?.message || String(e)}`);
  }
  if (!res.ok) {
    throw new PromptImportError('HTTP_ERROR', `원본 서버 응답 ${res.status}`);
  }
  const lenHeader = Number(res.headers.get('content-length'));
  if (Number.isFinite(lenHeader) && lenHeader > MAX_FETCH_BYTES) {
    throw new PromptImportError('FETCH_TOO_LARGE', '파일이 너무 큽니다 (>512KB).');
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_FETCH_BYTES) {
    throw new PromptImportError('FETCH_TOO_LARGE', '파일이 너무 큽니다 (>512KB).');
  }
  return buf.toString('utf-8');
}

export function parsePromptsFromText(text, { sourceUrl = null } = {}) {
  if (typeof text !== 'string') return [];
  const items = [];
  const fence = /(^|\n)((?:#{1,4})\s+([^\n]{1,200}))?\s*```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```/g;
  let m;
  while ((m = fence.exec(text)) !== null) {
    const headingText = m[3] || '';
    const body = m[4] || '';
    if (body.trim().length < MIN_BODY_LEN) continue;
    const title = headingText.trim().slice(0, 100);
    items.push({
      title,
      body: body.replace(/\r\n/g, '\n').trim(),
      sourceUrl,
    });
    if (items.length >= MAX_PROMPTS_PER_IMPORT) break;
  }
  if (items.length > 0) return items;
  const trimmed = text.replace(/\r\n/g, '\n').trim();
  if (trimmed.length >= MIN_BODY_LEN) {
    items.push({ title: '', body: trimmed.slice(0, 5000), sourceUrl });
  }
  return items;
}

export async function importFromGitHubUrl(url) {
  const rawUrl = toRawUrl(url);
  const text = await fetchText(rawUrl);
  const items = parsePromptsFromText(text, { sourceUrl: rawUrl });
  if (items.length === 0) {
    throw new PromptImportError(
      'NO_PROMPTS',
      'URL 에서 프롬프트를 찾지 못했습니다 (fenced code block 또는 의미 있는 본문이 없습니다).',
    );
  }
  return { sourceUrl: rawUrl, items };
}

export const _IMPORT_LIMITS = Object.freeze({
  MAX_FETCH_BYTES,
  MAX_PROMPTS_PER_IMPORT,
  MIN_BODY_LEN,
});
