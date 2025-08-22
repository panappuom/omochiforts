// copy-images.mjs  — 相対基準を「おもち要塞」にして flatten します
import fs from "fs";
import fsp from "fs/promises";
import path from "path";

// 相対基準（ここより下をファイル名に含める）
const ROOT = "G:\\マイドライブ\\おもち要塞";

// 走査対象（必要に応じて増減OK）
const SOURCES = [
  "G:\\マイドライブ\\おもち要塞",
];

// コピー先（1つのフォルダに集約）
const DST = "D:\\project\\omochiforts\\originals";

// 対象拡張子（小文字判定）
const exts = new Set([".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".heic"]);

// Windows のファイル名で使えない文字を安全化
function sanitizeForWin(name) {
  // 予約文字 <>:"/\|?* と制御文字を _
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

function isImage(filePath) {
  return exts.has(path.extname(filePath).toLowerCase());
}

// 「おもち要塞」からの相対パスを "_" で連結してファイル名に
function makeFlatNameFromRoot(filePath) {
  // 例: ROOT\booth\参考\animals\neko.png → booth\参考\animals\neko.png
  const relFromRoot = path.relative(ROOT, filePath);
  // → booth_参考_animals_neko.png
  const flat = relFromRoot.split(path.sep).join("_");
  return sanitizeForWin(flat);
}

async function uniquePath(dstDir, fileName) {
  const parsed = path.parse(fileName);
  let candidate = fileName;
  let i = 1;
  while (fs.existsSync(path.join(dstDir, candidate))) {
    candidate = `${parsed.name}_${i}${parsed.ext}`;
    i++;
  }
  return path.join(dstDir, candidate);
}

async function walkAndCopy(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      await walkAndCopy(full);
    } else if (ent.isFile() && isImage(full)) {
      const flatName = makeFlatNameFromRoot(full);     // ← 「おもち要塞」以降を連結
      const target = await uniquePath(DST, flatName);
      await ensureDir(DST);
      await fsp.copyFile(full, target);
      // 進捗を見たい場合は下行のコメントを外す:
      // console.log("copied:", target);
    }
  }
}

await ensureDir(DST);
for (const src of SOURCES) {
  await walkAndCopy(src);
}
console.log("✅ 完了");
