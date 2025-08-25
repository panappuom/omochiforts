// scripts/build-images.mjs
// おもち要塞：画像ビルド & インデックス生成（AVIF/WebP, s/s2x/l/l2x, LQIP, publicミラー）
//
// 依存: sharp, fast-glob, ulid
//   npm i -D sharp fast-glob ulid
//
// 仕様ポイント:
// - 入力: originalsDir（既定 originals/originals_upscaled、無ければ originals → src/originals）配下の .jpg/.jpeg/.png/.webp/.avif
// - 出力: src/assets/{s,s2x,l,l2x}/{id}.{avif,webp}   ← “正”の出力
// - ミラー: public/assets に差分同期（URLは常に /assets/... を書く）
// - images.json: src/data/images.json を唯一のメタ“真実”とする。既存レコードは人手項目(title/alt/tags等)を温存マージ
// - id: 既存があれば継承。無ければ「ファイル名がULIDなら採用」or「createdAtベースでULID生成」
// - createdAt: 既存なければ fs.stat.mtime を初期値（後で手修正OK）
// - 並び順: createdAt → 同時刻なら id（ULID）で安定ソート
// - LQIP: data URI (webp) で格納（任意）
//
// 実行: node scripts/build-images.mjs

import fg from 'fast-glob';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ulid as makeUlid } from 'ulid';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const cfg = require('../src/config/site.config.json');

// ===== 設定 =====
const IM = cfg.images ?? {};
const OUT_BASE  = IM.outputDir  ?? 'src/assets';
const PUB_BASE  = IM.publicDir  ?? 'public/assets';
const INDEX_JSON = 'src/data/images.json';
const CLEAN_OUTPUTS = !!(IM.cleanOutputs ?? false);

const W_S   = IM.smallWidth   ?? 236;
const W_S2  = IM.small2x      ?? W_S * 2;
const W_L   = IM.largeWidth   ?? 1200;
const W_L2  = IM.large2x      ?? W_L * 2;
const Q_S   = IM.qualitySmall ?? 72;
const Q_L   = IM.qualityLarge ?? 82;
const REBUILD_IF_NEWER = IM.rebuildIfNewer ?? true;
const FORMATS = (IM.formats ?? ['avif','webp']).map(s => s.toLowerCase());
const LQIP_ENABLED = !!IM.lqip?.enabled;
const LQIP_SIZE    = IM.lqip?.size ?? 24;
const LQIP_QUALITY = IM.lqip?.quality ?? 50;

// ===== upscaler を先行実行（SSOTの設定でスキップや閾値も反映） =====
function runUpscaler() {
  const node = process.execPath; // 現在の Node 実行ファイル
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const script = path.join(__dirname, 'upscale-images.mjs');
  console.log(`\n→ Running upscaler: ${node} ${script}`);
  const res = spawnSync(node, [script], { stdio: 'inherit', env: process.env });
  if (res.error) {
    console.error('Upscaler spawn error:', res.error);
    process.exit(1);
  }
  if (typeof res.status === 'number' && res.status !== 0) {
    console.error(`Upscaler exited with status ${res.status}`);
    process.exit(res.status);
  }
  console.log('← Upscaler finished');
}
runUpscaler();

// アップスケール後に ORIGINALS を解決（upscaled 出力が新規作成された場合にも対応）
const ORIGINALS = resolveExisting(IM.originalsDir ?? 'originals/originals_upscaled');

// ===== Effective Config logging (Single Source of Truth: src/config/site.config.json) =====
console.log("Effective Config (images):", JSON.stringify({
  originalsDir: ORIGINALS,
  outputDir: OUT_BASE,
  publicDir: PUB_BASE,
  smallWidth: W_S,
  small2x: W_S2,
  largeWidth: W_L,
  large2x: W_L2,
  qualitySmall: Q_S,
  qualityLarge: Q_L,
  rebuildIfNewer: REBUILD_IF_NEWER,
  formats: FORMATS,
  lqip: { enabled: LQIP_ENABLED, size: LQIP_SIZE, quality: LQIP_QUALITY },
  cleanOutputs: CLEAN_OUTPUTS
}, null, 2));

// 出力ディレクトリ（サイズ別）
const DIR_S  = path.join(OUT_BASE, 's');
const DIR_S2 = path.join(OUT_BASE, 's2x');
const DIR_L  = path.join(OUT_BASE, 'l');
const DIR_L2 = path.join(OUT_BASE, 'l2x');

// ===== utils =====
function resolveExisting(...candidates) {
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return candidates[0];
}
const isUlidLike = (s) => typeof s === 'string' && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(s);
const fileStem = (p) => path.basename(p, path.extname(p)).replace(/\s+/g, '_');
const ms = (t)=> (t>=1000 ? `${(t/1000).toFixed(1)}s` : `${t}ms`);
const ensureDir = (p)=> fs.mkdirSync(p, { recursive: true });
const posix = (p)=> p.split(path.sep).join('/');
const urlFromPub = (abs) => '/' + path.posix.join('assets', posix(path.relative(PUB_BASE, abs)));

async function getMeta(inPath) {
  try { return await sharp(inPath).rotate().metadata(); }
  catch { return { width: undefined, height: undefined }; }
}
async function lqipData(inPath) {
  if (!LQIP_ENABLED) return null;
  try {
    const buf = await sharp(inPath).rotate().resize({ width: LQIP_SIZE, withoutEnlargement:true }).webp({ quality: LQIP_QUALITY }).toBuffer();
    return `data:image/webp;base64,${buf.toString('base64')}`;
  } catch { return null; }
}
async function needBuild(src, dst) {
  if (!fs.existsSync(dst)) return true;
  if (!REBUILD_IF_NEWER) return false;
  try {
    const [ss, ds] = await Promise.all([fs.promises.stat(src), fs.promises.stat(dst)]);
    return ss.mtimeMs > ds.mtimeMs + 1;
  } catch { return true; }
}
function walkFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes:true }).flatMap(d => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walkFiles(p) : [p];
  });
}
async function mirrorDir(srcDir, dstDir) {
  // 単一ディレクトリ運用（同一パス）の場合は何もしない
  if (path.resolve(srcDir) === path.resolve(dstDir)) return;
  ensureDir(dstDir);
  // copy/update
  for (const s of walkFiles(srcDir)) {
    const rel = path.relative(srcDir, s);
    const d = path.join(dstDir, rel);
    ensureDir(path.dirname(d));
    let copy = true;
    try {
      const ss = fs.statSync(s);
      const ds = fs.statSync(d);
      copy = ss.size !== ds.size || ss.mtimeMs > ds.mtimeMs + 1;
    } catch {}
    if (copy) fs.copyFileSync(s, d);
  }
  // remove stale
  for (const d of walkFiles(dstDir)) {
    const rel = path.relative(dstDir, d);
    const s = path.join(srcDir, rel);
    if (!fs.existsSync(s)) fs.rmSync(d, { force:true });
  }
}

// ===== 既存 index 読み込み（人手項目を保護） =====
let prev = [];
try { prev = JSON.parse(fs.readFileSync(INDEX_JSON, 'utf-8')); } catch {}
const prevById = new Map(prev.map(r => [r.id, r]));
const prevBySource = new Map(prev.filter(r => r.source).map(r => [r.source, r]));

// ===== 入力走査 =====
const inputs = await fg(['**/*.{jpg,jpeg,png,webp,avif}'], { cwd: ORIGINALS, dot:false, onlyFiles:true });
if (!inputs.length) {
  console.log(`No source images found in ${ORIGINALS}`);
  process.exit(0);
}

// 出力用ディレクトリ
[DIR_S, DIR_S2, DIR_L, DIR_L2].forEach(ensureDir);

const t0 = Date.now();
const outIndex = [];
let made = 0, skipped = 0;

// ===== 変換ループ =====
for (const rel of inputs) {
  const inAbs = path.resolve(ORIGINALS, rel);
  const relPosix = posix(rel);
  const stem = fileStem(rel);

  // 既存レコードを探索（id一致 or ファイル名一致（移行期））
  // 既存レコード検索: source 優先 → 旧互換のヒューリスティック
  let current = prevBySource.get(relPosix) || prevById.get(stem) || prev.find(r =>
    r.id === stem || r.sizes?.s?.webp?.includes(`/${stem}.webp`)
  );

  // 基本メタ
  const stat = fs.statSync(inAbs);
  const meta = await getMeta(inAbs);

  // createdAt: 既存 or mtime
  const createdAt = current?.createdAt ?? new Date(stat.mtimeMs).toISOString();
  // sortKey: 既存の createdAt と比較して維持/更新（新規は createdAt を epoch(ms) に）
  const prevCreatedAt = current?.createdAt;
  const prevSortKey = (typeof current?.sortKey === 'number') ? current.sortKey : undefined;
  const createdEpoch = Date.parse(createdAt || 0);
  const sortKey = (current
    ? (prevCreatedAt === createdAt && typeof prevSortKey === 'number')
        ? prevSortKey
        : createdEpoch
    : createdEpoch);

  // id: 既存→継承 / 無ければ (ファイル名がULIDなら採用) or (createdAtでULID生成)
  const id = current?.id ?? (isUlidLike(stem) ? stem : makeUlid(Date.parse(createdAt)));

  // 出力先
  const outPaths = {
    s:  Object.fromEntries(FORMATS.map(f => [f, path.join(DIR_S,  `${id}.${f}`)])),
    s2x:Object.fromEntries(FORMATS.map(f => [f, path.join(DIR_S2, `${id}.${f}`)])),
    l:  Object.fromEntries(FORMATS.map(f => [f, path.join(DIR_L,  `${id}.${f}`)])),
    l2x:Object.fromEntries(FORMATS.map(f => [f, path.join(DIR_L2, `${id}.${f}`)])),
  };

  // 生成関数
  async function buildOne(width, dstMap, quality) {
    for (const fmt of FORMATS) {
      const dst = dstMap[fmt];
      if (await needBuild(inAbs, dst)) {
        const pipe = sharp(inAbs)
          .rotate()
          // 長辺を width に収める（縦横どちらでも最大寸法が width 以下になる）
          .resize({ width, height: width, fit: 'inside', withoutEnlargement: true });
        if (fmt === 'avif') await pipe.avif({ quality }).toFile(dst);
        else if (fmt === 'webp') await pipe.webp({ quality }).toFile(dst);
        else throw new Error(`Unsupported format: ${fmt}`);
        made++;
      } else {
        skipped++;
      }
    }
  }

  await buildOne(W_S,  outPaths.s,  Q_S);
  await buildOne(W_S2, outPaths.s2x, Q_S);
  await buildOne(W_L,  outPaths.l,  Q_L);
  await buildOne(W_L2, outPaths.l2x, Q_L);

  // public/assets にミラー（差分）
  await mirrorDir(OUT_BASE, PUB_BASE);

  // URL化（/assets/...）
  const urls = {
    s:   Object.fromEntries(FORMATS.map(f => [f, urlFromPub(path.join(PUB_BASE, 's',   `${id}.${f}`))])),
    s2x: Object.fromEntries(FORMATS.map(f => [f, urlFromPub(path.join(PUB_BASE, 's2x', `${id}.${f}`))])),
    l:   Object.fromEntries(FORMATS.map(f => [f, urlFromPub(path.join(PUB_BASE, 'l',   `${id}.${f}`))])),
    l2x: Object.fromEntries(FORMATS.map(f => [f, urlFromPub(path.join(PUB_BASE, 'l2x', `${id}.${f}`))])),
  };

  // LQIP
  const lqip = await lqipData(inAbs);

  // レコード生成（既存の人手項目は温存）
  const keep = current ?? {};
  const record = {
    id,
    source: relPosix,
    title: keep.title ?? '',        // 人手で編集OK
    alt: keep.alt ?? '',
    series: keep.series ?? [],
    characters: keep.characters ?? [],
    tags: keep.tags ?? [],
    createdAt,                      // 既存優先
    sortKey,                        // 並び制御用（ms epoch）
    w: meta.width,
    h: meta.height,
    lqip,
    sizes: urls,
    caption: keep.caption ?? '',
    links: keep.links ?? { products: [], related: [] },
  };

  outIndex.push(record);
}

// 並び順: createdAt → id（ULID）で安定
outIndex.sort((a,b)=>{
  const sa = (typeof a.sortKey === 'number') ? a.sortKey : Date.parse(a.createdAt || 0);
  const sb = (typeof b.sortKey === 'number') ? b.sortKey : Date.parse(b.createdAt || 0);
  if (sa !== sb) return sa - sb;
  return String(a.id).localeCompare(String(b.id));
});

// JSON出力
ensureDir(path.dirname(INDEX_JSON));
fs.writeFileSync(INDEX_JSON, JSON.stringify(outIndex, null, 2), 'utf-8');

// （オプション）不要出力のクリーンアップ（index に存在しない id を削除）
if (CLEAN_OUTPUTS) {
  const keepIds = new Set(outIndex.map(r => String(r.id)));
  const sizeDirs = [
    { dir: DIR_S,  label: 's'   },
    { dir: DIR_S2, label: 's2x' },
    { dir: DIR_L,  label: 'l'   },
    { dir: DIR_L2, label: 'l2x' }
  ];
  for (const {dir} of sizeDirs) {
    try {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        const base = path.basename(f, path.extname(f));
        if (!keepIds.has(base)) {
          try { fs.rmSync(path.join(dir, f), { force: true }); } catch {}
        }
      }
    } catch {}
  }
  // クリーン後に public を再ミラー
  await mirrorDir(OUT_BASE, PUB_BASE);
}

// 追加: クライアント用の軽量インデックスを public/images-index.json に出力（新着順）
try {
  const PUB_ROOT = path.dirname(PUB_BASE);
  ensureDir(PUB_ROOT);
  const slim = outIndex
    .slice()
    .sort((a,b)=>{
      const sa = (typeof a.sortKey === 'number') ? a.sortKey : Date.parse(a.createdAt || 0);
      const sb = (typeof b.sortKey === 'number') ? b.sortKey : Date.parse(b.createdAt || 0);
      if (sa !== sb) return sb - sa; // desc
      return String(a.id).localeCompare(String(b.id));
    })
    .map(r => ({
      src: r?.sizes?.s?.avif ?? r?.sizes?.s?.webp ?? r?.sizes?.l?.avif ?? r?.sizes?.l?.webp ?? '',
      w: r.w, h: r.h,
      tags: Array.isArray(r.tags) ? r.tags : []
    }));
  fs.writeFileSync(path.join(PUB_ROOT, 'images-index.json'), JSON.stringify(slim), 'utf-8');
} catch (e) {
  console.warn('Warn: failed to write public/images-index.json', e);
}

// まとめ
console.log(`\n✓ images.json written (${outIndex.length} items)`);
console.log(`✓ outputs: ${OUT_BASE}  → mirrored →  ${PUB_BASE}`);
console.log(`✓ made=${made}, skipped=${skipped}, time=${ms(Date.now()-t0)}\n`);
