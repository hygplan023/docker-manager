import { Router } from "express";
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { deflateRawSync } from "node:zlib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const router = Router();

// 稳健地向上查找包含 pnpm-workspace.yaml 的项目根目录，
// 避免因构建产物位置变化导致 ROOT 指向错误目录（曾误指向 /home/runner）
function findWorkspaceRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  // 兜底：从 artifacts/api-server/dist 回到工作区根（三级）
  return join(start, "../../../");
}

const ROOT = findWorkspaceRoot(import.meta.dirname);
const ZIP_PATH = join(ROOT, "dist-package.zip");

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", ".pnpm-store", ".local",
  "coverage", "__pycache__", ".turbo",
  ".cache", ".agents", "attached_assets", "tmp", ".upm", ".config",
]);
const SKIP_NAMES = new Set(["dist-package.zip"]);

function walkSync(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name) || SKIP_NAMES.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkSync(full));
    else if (entry.isFile()) results.push(full);
  }
  return results;
}

function crc32(buf: Buffer): number {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function buildZip(): void {
  const d = new Date();
  const modDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const modTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);

  const allFiles = walkSync(ROOT);
  const chunks: Buffer[] = [];
  const centralDirs: Array<{
    nameBytes: Buffer; crc: number; compSize: number;
    uncompSize: number; offset: number; useDeflate: boolean; unixMode: number;
  }> = [];
  let offset = 0;

  for (const full of allFiles) {
    let data: Buffer;
    try { data = readFileSync(full); } catch { continue; }

    const rel = relative(ROOT, full).replace(/\\/g, "/");
    if (rel.endsWith(".bat")) {
      data = Buffer.from(data.toString("latin1").replace(/\r?\n/g, "\r\n"), "latin1");
    }
    if (rel === "package.json") {
      try {
        const pkg = JSON.parse(data.toString("utf8"));
        if (pkg?.scripts?.preinstall) {
          delete pkg.scripts.preinstall;
          data = Buffer.from(JSON.stringify(pkg, null, 2) + "\n", "utf8");
        }
      } catch {
        // leave package.json untouched if it cannot be parsed
      }
    }
    const nameBytes = Buffer.from(rel, "utf8");
    const compressed = deflateRawSync(data, { level: 6 });
    const useDeflate = compressed.length < data.length;
    const fileData = useDeflate ? compressed : data;
    const crc = crc32(data);

    const localHeader = Buffer.alloc(30 + nameBytes.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(useDeflate ? 8 : 0, 8);
    localHeader.writeUInt16LE(modTime, 10);
    localHeader.writeUInt16LE(modDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(fileData.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBytes.copy(localHeader, 30);

    const unixMode = 0o100000 | (rel.endsWith(".sh") ? 0o755 : 0o644);
    centralDirs.push({ nameBytes, crc, compSize: fileData.length, uncompSize: data.length, offset, useDeflate, unixMode });
    chunks.push(localHeader, fileData);
    offset += localHeader.length + fileData.length;
  }

  const cdStart = offset;
  for (const e of centralDirs) {
    const cd = Buffer.alloc(46 + e.nameBytes.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE((3 << 8) | 20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(e.useDeflate ? 8 : 0, 10);
    cd.writeUInt16LE(modTime, 12);
    cd.writeUInt16LE(modDate, 14);
    cd.writeUInt32LE(e.crc, 16);
    cd.writeUInt32LE(e.compSize, 20);
    cd.writeUInt32LE(e.uncompSize, 24);
    cd.writeUInt16LE(e.nameBytes.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE((e.unixMode << 16) >>> 0, 38);
    cd.writeUInt32LE(e.offset, 42);
    e.nameBytes.copy(cd, 46);
    chunks.push(cd);
    offset += cd.length;
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(centralDirs.length, 8);
  eocd.writeUInt16LE(centralDirs.length, 10);
  eocd.writeUInt32LE(offset - cdStart, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);
  chunks.push(eocd);

  writeFileSync(ZIP_PATH, Buffer.concat(chunks));
}

// Create and download the project zip package
router.get("/download/package", async (req, res) => {
  try {
    buildZip();
    if (!existsSync(ZIP_PATH)) {
      return res.status(500).json({ error: "打包失败" });
    }
    res.setHeader("Content-Disposition", "attachment; filename=codex-manager.zip");
    res.setHeader("Content-Type", "application/zip");
    return res.sendFile(ZIP_PATH);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

// Check Codex CLI connection readiness
router.post("/codex/check", async (req, res) => {
  const { ollamaUrl = "http://localhost:11434" } = req.body as { ollamaUrl?: string };

  let ollamaOk = false;
  let ollamaModels: string[] = [];
  let ollamaError = "";

  try {
    const resp = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (resp.ok) {
      const data = (await resp.json()) as { models?: Array<{ name: string }> };
      ollamaModels = (data.models || []).map((m) => m.name);
      ollamaOk = true;
    } else {
      ollamaError = `HTTP ${resp.status}`;
    }
  } catch (e: unknown) {
    ollamaError = e instanceof Error ? e.message : "连接超时";
  }

  let codexInstalled = false;
  let codexVersion = "";
  try {
    const { stdout } = await execFileAsync("npx", ["@openai/codex", "--version"], {
      timeout: 8000,
      env: { ...process.env, PATH: process.env.PATH },
    });
    codexInstalled = true;
    codexVersion = stdout.trim().split("\n")[0] || "已安装";
  } catch {
    codexInstalled = false;
  }

  const openaiBaseUrl = ollamaUrl.endsWith("/v1") ? ollamaUrl : `${ollamaUrl}/v1`;

  return res.json({
    ollamaOk,
    ollamaModels,
    ollamaError,
    codexInstalled,
    codexVersion,
    openaiBaseUrl,
    readyToRun: ollamaOk,
    configYaml: ollamaOk && ollamaModels.length > 0
      ? `model: "${ollamaModels[0]}"\nprovider: ollama\nbaseURL: "${openaiBaseUrl}"\napiKey: "ollama"\napprovalMode: suggest`
      : null,
    winCmd: `$env:OPENAI_BASE_URL="${openaiBaseUrl}"\n$env:OPENAI_API_KEY="ollama"\nnpx @openai/codex`,
    macCmd: `OPENAI_BASE_URL="${openaiBaseUrl}" OPENAI_API_KEY="ollama" npx @openai/codex`,
  });
});

export default router;
