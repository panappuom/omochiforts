// upscale-images.mjs
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";

const execFileAsync = promisify(execFile);

const ROOT = "D:/project/omochiforts/originals";
const SRC = path.join(ROOT, "originals_lowres");
const DST = path.join(ROOT, "originals_upscaled");

// ツールのパス（要調整）
const WAIFU2X = path.join(ROOT, "tools/waifu2x/waifu2x-ncnn-vulkan.exe");
// const REALESRGAN = path.join(ROOT, "tools/realesrgan/realesrgan-ncnn-vulkan.exe");

const exts = new Set([".jpg", ".jpeg", ".png", ".webp"]);

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function walkAndUpscale(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      await walkAndUpscale(full);
    } else {
      const ext = path.extname(ent.name).toLowerCase();
      if (!exts.has(ext)) continue;

      // 出力先ファイル名（階層を "_" に変換）
      const rel = path.relative(SRC, full);
      const flat = rel.split(path.sep).join("_");
      const outPath = path.join(DST, flat);

      if (fs.existsSync(outPath)) {
        console.log("skip", outPath);
        continue;
      }

      await ensureDir(DST);

      console.log("upscaling:", full);

      try {
        // waifu2x 実行例: 2倍, ノイズ除去1, タイル512, アニメ向けモデル
        await execFileAsync(WAIFU2X, [
          "-i", full,
          "-o", outPath,
          "-n", "1",
          "-s", "2",
          "-t", "512",
          "-m", "models-cunet"
        ]);
        console.log("done:", outPath);
      } catch (err) {
        console.error("❌ error on", full, err);
      }
    }
  }
}

await ensureDir(DST);
await walkAndUpscale(SRC);
console.log("✅ 全部完了");
