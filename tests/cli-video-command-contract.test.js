import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI_ARGS = ["--import", "tsx", "/Users/jun/Developer/new/700_projects/ima2-gen/bin/ima2.ts"];
const tempDirs = [];
const servers = [];

function runCLI(args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...CLI_ARGS, ...args], {
      env: { ...process.env, NO_COLOR: "1", IMA2_SERVER: "", ...(opts.env || {}) },
      cwd: opts.cwd || process.cwd(),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function listen(server) {
  servers.push(server);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

async function tmpDir(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeServer(handler) {
  return createServer((req, res) => {
    if (req.url === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, provider: "oauth" }));
      return;
    }
    handler(req, res);
  });
}

after(async () => {
  for (const server of servers) {
    server.closeAllConnections?.();
    server.close();
  }
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

describe("ima2 video CLI contracts", () => {
  it("documents video subcommands in help", async () => {
    const { code, stdout } = await runCLI(["video", "--help"]);
    assert.equal(code, 0);
    assert.match(stdout, /ima2 video <prompt/);
    assert.match(stdout, /ima2 video edit/);
    assert.match(stdout, /ima2 video extend <prompt> --video <url> \[--duration 6\]/);
    assert.match(stdout, /ima2 video frame/);
    assert.match(stdout, /ima2 video analyze <generated-file>/);
    assert.match(stdout, /--topic <text>/);
    assert.match(stdout, /grok-imagine-video-1\.5-preview/);
  });

  it("rejects invalid generate and extend durations before network calls", async () => {
    const noPrompt = await runCLI(["video"]);
    assert.equal(noPrompt.code, 2);
    assert.match(noPrompt.stderr, /prompt is required/);

    const badGenerate = await runCLI(["video", "clip", "--duration", "6abc"]);
    assert.equal(badGenerate.code, 2);
    assert.match(badGenerate.stderr, /--duration must be an integer/);

    const badExtend = await runCLI(["video", "extend", "continue", "--video", "https://example.com/a.mp4", "--duration", "999"]);
    assert.equal(badExtend.code, 2);
    assert.match(badExtend.stderr, /--duration must be between 2 and 10/);

    const badExtendBeforeServer = await runCLI(["video", "extend", "continue", "--video", "https://example.com/a.mp4", "--duration", "abc", "--server", "http://127.0.0.1:9"]);
    assert.equal(badExtendBeforeServer.code, 2);
    assert.match(badExtendBeforeServer.stderr, /--duration must be an integer/);
    assert.doesNotMatch(badExtendBeforeServer.stderr, /server unreachable/);

    const badTimeout = await runCLI(["video", "clip", "--timeout", "1abc"]);
    assert.equal(badTimeout.code, 2);
    assert.match(badTimeout.stderr, /--timeout must be an integer/);

    const zeroTimeout = await runCLI(["video", "edit", "p", "--video", "https://example.com/v.mp4", "--timeout", "0"]);
    assert.equal(zeroTimeout.code, 2);
    assert.match(zeroTimeout.stderr, /--timeout must be at least 1/);

    const unknown = await runCLI(["video", "clip", "--duraton", "5"]);
    assert.equal(unknown.code, 2);
    assert.match(unknown.stderr, /unknown option: --duraton/);
  });

  it("passes edit/extend timeout to fetch", async () => {
    const server = makeServer((req, res) => {
      if (req.url?.startsWith("/api/video/edit")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return;
      }
      res.writeHead(404).end();
    });
    const base = await listen(server);
    const started = Date.now();
    const result = await runCLI(["video", "edit", "p", "--video", "https://example.com/v.mp4", "--timeout", "1", "--server", base]);
    assert.ok(Date.now() - started < 4000, "timeout should end quickly");
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /abort|timeout|terminated/i);
  });

  it("keeps frame output deterministic for nested input and --out alias", async () => {
    const cwd = await tmpDir("ima2-video-cli-frame-");
    const server = makeServer((req, res) => {
      if (req.url?.startsWith("/api/video/frame")) {
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(Buffer.from("PNGDATA"));
        return;
      }
      res.writeHead(404).end();
    });
    const base = await listen(server);
    const output = join(cwd, "nested", "wanted.png");
    const result = await runCLI(["video", "frame", "clips/sample.mp4", "--out", output, "--server", base]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Frame saved:/);
    assert.equal((await readFile(output)).toString(), "PNGDATA");
    assert.equal(existsSync(join(cwd, "frame-clips", "sample.png")), false);
  });

  it("reports non-JSON subcommand responses without raw stack traces", async () => {
    const server = makeServer((req, res) => {
      if (req.url?.startsWith("/api/video/analyze")) {
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end("bad gateway");
        return;
      }
      res.writeHead(404).end();
    });
    const base = await listen(server);
    const result = await runCLI(["video", "analyze", "sample.mp4", "--server", base]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /expected JSON response/);
    assert.doesNotMatch(result.stderr, /SyntaxError|node:internal/);
  });
});
