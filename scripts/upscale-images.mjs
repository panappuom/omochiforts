// scripts/upscale-images.mjs  (logging付き)
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { imageSize } from "image-size";

const execFileAsync = promisify(execFile);

// ルートと各パス
const ROOT = "D:/project/omochiforts/originals";
const SRC = path.join(ROOT, "originals_lowres");
const DST = path.join(ROOT, "originals_upscaled");
const LOG = path.join(ROOT, "upscale-report.tsv");  // ここに追記

// ツール
const WAIFU2X   = path.join(ROOT, "tools/waifu2x/waifu2x-ncnn-vulkan.exe");
const REALESRGAN = path.join(ROOT, "tools/realesrgan/realesrgan-ncnn-vulkan.exe");

// 拡張子と閾値
const exts = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const TARGET_UPSCALED = 2000;
const MIN_FOR_EASY = 700;
const MIN_FOR_HARD = 250;

// 統計
const stats = { total:0, skipped:0, w2xOnce:0, w2xTwice:0, realesrganUsed:0, errors:0 };

async function ensureDir(dir){ await fsp.mkdir(dir,{recursive:true}); }
function flatName(base, full){ return path.relative(base, full).split(path.sep).join("_"); }
async function readSize(file){ const {width,height}=imageSize(await fsp.readFile(file)); return {width, height}; }
function maxSide({width,height}){ return Math.max(width??0, height??0); }

async function logLine({src, out, method, model="", scale="", extra=""}) {
  const line = [
    new Date().toISOString(),
    src,
    out,
    method,     // Waifu2x / RealESRGAN / Skip / Error
    model,      // models-cunet / realesr-animevideov3 など
    scale,      // 2x, 4xなど（表記用）
    extra       // 任意メモ
  ].join("\t") + "\n";
  await fsp.appendFile(LOG, line, "utf8");
}

// Real-ESRGAN モデルディレクトリ検出
async function findModelsDir(modelName) {
  // 環境変数優先
  const envDir = process.env.REALESRGAN_MODELS || process.env.REAL_ESRGAN_MODELS;
  if (envDir) {
    const p1 = path.join(envDir, `${modelName}.param`);
    const b1 = path.join(envDir, `${modelName}.bin`);
    if (fs.existsSync(p1) && fs.existsSync(b1)) return envDir;
  }

  const base = path.dirname(REALESRGAN);
  const direct = path.join(base, "models");
  const p2 = path.join(direct, `${modelName}.param`);
  const b2 = path.join(direct, `${modelName}.bin`);
  if (fs.existsSync(p2) && fs.existsSync(b2)) return direct;

  // 直下のサブディレクトリを走査
  const entries = await fsp.readdir(base, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const cand = path.join(base, ent.name);
    const p = path.join(cand, `${modelName}.param`);
    const b = path.join(cand, `${modelName}.bin`);
    if (fs.existsSync(p) && fs.existsSync(b)) return cand;
  }
  return null;
}

async function listAvailableModels() {
  const base = path.dirname(REALESRGAN);
  const dirs = [path.join(base, "models")];
  try {
    const entries = await fsp.readdir(base, { withFileTypes: true });
    for (const ent of entries) if (ent.isDirectory()) dirs.push(path.join(base, ent.name));
  } catch {}
  const set = new Set();
  for (const d of dirs) {
    try {
      const files = await fsp.readdir(d);
      for (const f of files) if (f.endsWith(".param")) set.add(path.basename(f, ".param"));
    } catch {}
  }
  return Array.from(set).sort();
}

async function runWaifu2x(input, output, { scale=2, noise=1, tile=512, model="models-cunet" } = {}) {
  console.log(`→ Waifu2x: s=${scale} n=${noise} model=${model}`);
  try {
    await execFileAsync(
      WAIFU2X,
      [
        "-i", input,
        "-o", output,
        "-s", String(scale),
        "-n", String(noise),
        "-t", String(tile),
        "-m", model
      ],
      { cwd: path.dirname(WAIFU2X) }
    );
    await logLine({ src: input, out: output, method: "Waifu2x", model, scale: `${scale}x` });
  } catch (err) {
    console.error("Waifu2x ERROR:", err.stderr?.toString?.() || err.message);
    throw err;
  }
}

async function runRealESRGAN(input, output, { scale=2, tile=0, modelName="realesr-animevideov3" } = {}) {
  console.log(`→ Real-ESRGAN: s=${scale} -n ${modelName}`);
  const modelsDir = await findModelsDir(modelName);
  if (!modelsDir) {
    const avail = await listAvailableModels();
    const base = path.dirname(REALESRGAN);
    throw new Error(`model not found in ${base}/(models|*) => ${modelName}  available=[${avail.join(", ")}]`);
  }

  try {
    await execFileAsync(
      REALESRGAN,
      [
        "-i", input,
        "-o", output,
        "-s", String(scale),
        "-t", String(tile),     // 0=自動（推奨）
        "-m", modelsDir,        // ← フォルダを渡す
        "-n", modelName         // ← モデル名を渡す（realesr-animevideov3 等）
      ],
      { cwd: path.dirname(REALESRGAN) }
    );
    await logLine({ src: input, out: output, method: "RealESRGAN", model: modelName, scale: `${scale}x` });
    stats.realesrganUsed++;
  } catch (err) {
    console.error("Real-ESRGAN ERROR:", err.stderr?.toString?.() || err.message);
    await logLine({ src: input, out: output, method: "Error", model: modelName, extra: (err.stderr?.toString?.() || err.message) });
    throw err;
  }
}

async function upscaleSmart(full, outPath) {
  const { width, height } = await readSize(full);
  const m = maxSide({ width, height });
  if (!m) throw new Error("size read failed");

  if (fs.existsSync(outPath)) {
    console.log(`skip (exists): ${outPath}`);
    stats.skipped++;
    await logLine({ src: full, out: outPath, method: "Skip", extra: "exists" });
    return;
  }

  await ensureDir(path.dirname(outPath));
  stats.total++;

  // A) 700px以上：2xだけで十分なケース
  if (m >= MIN_FOR_EASY) {
    console.log(`process: ${full}  [max=${m}]  plan: Waifu2x x2`);
    await runWaifu2x(full, outPath, { scale: 2, noise: 1, model: "models-cunet" });
    stats.w2xOnce++;
    return;
  }

  const tmp1 = outPath.replace(/(\.[^.]+)$/, "_tmp1$1");
  const tmp2 = outPath.replace(/(\.[^.]+)$/, "_tmp2$1");

  // C) 250px以下：段階拡大＋整形
  if (m <= MIN_FOR_HARD) {
    console.log(`process: ${full}  [max=${m}]  plan: Waifu2x x2 -> x2 (+ RealESRGAN if available)`);
    await runWaifu2x(full, tmp1, { scale: 2, noise: 1, model: "models-cunet" });
    await runWaifu2x(tmp1, tmp2, { scale: 2, noise: 0, model: "models-cunet" });
    stats.w2xTwice++;

    if (fs.existsSync(REALESRGAN)) {
      await runRealESRGAN(tmp2, outPath, { scale: 2, modelName: "realesr-animevideov3-x2" });
      try { await fsp.unlink(tmp1); await fsp.unlink(tmp2); } catch {}
    } else {
      await fsp.rename(tmp2, outPath);
      try { await fsp.unlink(tmp1); } catch {}
    }
    return;
  }

  // B) 250〜700px：2x後にさらに持ち上げ（RealESRGAN優先）
  console.log(`process: ${full}  [max=${m}]  plan: Waifu2x x2 -> (RealESRGAN x2 | Waifu2x x2)`);
  await runWaifu2x(full, tmp1, { scale: 2, noise: 1, model: "models-cunet" });
  stats.w2xOnce++;

  if (fs.existsSync(REALESRGAN)) {
    await runRealESRGAN(tmp1, outPath, { scale: 2, modelName: "realesr-animevideov3-x2" });
    try { await fsp.unlink(tmp1); } catch {}
  } else {
    await runWaifu2x(tmp1, outPath, { scale: 2, noise: 0, model: "models-cunet" });
    stats.w2xTwice++;
    try { await fsp.unlink(tmp1); } catch {}
  }
}

async function walkAndProcess(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      await walkAndProcess(full);
    } else {
      const ext = path.extname(ent.name).toLowerCase();
      if (!exts.has(ext)) continue;

      const outName = flatName(SRC, full);
      const outPath = path.join(DST, outName);

      try {
        await upscaleSmart(full, outPath);
      } catch (e) {
        console.error("❌ Error:", full, e.message);
        stats.errors++;
        await logLine({ src: full, out: outPath, method: "Error", extra: e.message });
      }
    }
  }
}

// ヘッダを書いておく（存在しなければ）
if (!fs.existsSync(LOG)) {
  await fsp.writeFile(LOG, "timestamp\tsrc\tout\tmethod\tmodel\tscale\textra\n", "utf8");
}

await ensureDir(DST);
await walkAndProcess(SRC);

console.log("—— Summary ——");
console.log(stats);
