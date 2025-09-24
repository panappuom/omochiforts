// scripts/build-images.mjs
// おもち要塞：画像ビルド & インデックス生成（AVIF/WebP, s/s2x/l/l2x, LQIP）
//
// 依存: sharp, fast-glob, ulid
//   npm i -D sharp fast-glob ulid
//
// 仕様ポイント:
// - 入力: originalsDir（既定 originals/originals_upscaled、無ければ originals → src/originals）配下の .jpg/.jpeg/.png/.webp/.avif
// - 出力: public/assets/{s,s2x,l,l2x}/{id}.{avif,webp}   ← 単一ディレクトリに出力
// - images.json: src/data/images.json を唯一のメタ“真実”とする（正本）。既存レコードは人手項目(title/alt/tags等)を温存マージ
//   → 生成物は src/data/_generated/images.gen.json に出力し、正本は読み取り専用扱い
// - id: 既存があれば継承。無ければ「ファイル名がULIDなら採用」or「createdAtベースでULID生成」
// - createdAt: 既存なければ fs.stat.mtime を初期値（後で手修正OK）
// - 並び順: createdAt → 同時刻なら id（ULID）で安定ソート
// - LQIP: data URI (webp) で格納（任意）
//
// 実行: node scripts/build-images.mjs

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { runStillsPipeline, preferCoverSrc } from './pipeline/stills.mjs';
const require = createRequire(import.meta.url);
const cfg = require('../src/config/site.config.json');

// ===== 設定 =====
const IM = cfg.images ?? {};
const OUT_BASE  = IM.outputDir  ?? 'public/assets';
const INDEX_SOURCE = 'src/data/images.json';
const GENERATED_DIR = 'src/data/_generated';
const GENERATED_INDEX = path.join(GENERATED_DIR, 'images.gen.json');
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
  publicDir: OUT_BASE, // unified
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
const ms = (t)=> (t>=1000 ? `${(t/1000).toFixed(1)}s` : `${t}ms`);
const ensureDir = (p)=> fs.mkdirSync(p, { recursive: true });
// 旧 mirrorDir は不要（単一ディレクトリ出力のため削除）

function sha256File(p) {
  try {
    const buf = fs.readFileSync(p);
    return createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

const sourceHashBefore = sha256File(INDEX_SOURCE);
if (sourceHashBefore) {
  console.log(`[build:media] src/data/images.json sha256 (before): ${sourceHashBefore}`);
} else {
  console.log('[build:media] src/data/images.json sha256 (before): <unavailable>');
}

// ===== 既存 index 読み込み（人手項目を保護） =====
let prev = [];
try { prev = JSON.parse(fs.readFileSync(INDEX_SOURCE, 'utf-8')); } catch {}

const stillsResult = await runStillsPipeline({
  originalsDir: ORIGINALS,
  outputDir: OUT_BASE,
  prevRecords: prev,
  formats: FORMATS,
  widths: { s: W_S, s2x: W_S2, l: W_L, l2x: W_L2 },
  quality: { small: Q_S, large: Q_L },
  rebuildIfNewer: REBUILD_IF_NEWER,
  lqip: { enabled: LQIP_ENABLED, size: LQIP_SIZE, quality: LQIP_QUALITY },
  publicBasePath: '/assets',
});

if (stillsResult.aborted) {
  process.exit(0);
}

const outIndex = stillsResult.records;
const made = stillsResult.made;
const skipped = stillsResult.skipped;
const pipelineDurationMs = stillsResult.durationMs;

// JSON出力
ensureDir(GENERATED_DIR);
fs.writeFileSync(GENERATED_INDEX, JSON.stringify(outIndex, null, 2), 'utf-8');

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
}

// 追加: クライアント用の軽量インデックスを public/images-index.json に出力（新着順）
try {
  const OUT_ROOT = path.dirname(OUT_BASE);
  ensureDir(OUT_ROOT);
  const slim = outIndex
    .slice()
    .sort((a,b)=>{
      const sa = (typeof a.sortKey === 'number') ? a.sortKey : Date.parse(a.createdAt || 0);
      const sb = (typeof b.sortKey === 'number') ? b.sortKey : Date.parse(b.createdAt || 0);
      if (sa !== sb) return sb - sa; // desc
      return String(a.id).localeCompare(String(b.id));
    })
    .map(r => {
      const cover = (r && typeof r.cover === 'object') ? r.cover : null;
      const coverSizes = cover?.sizes ?? r?.sizes;
      const coverSrc = (cover && typeof cover.src === 'string' && cover.src)
        ? cover.src
        : preferCoverSrc(coverSizes);
      const coverW = (cover && Number.isFinite(cover.w)) ? cover.w : r.w;
      const coverH = (cover && Number.isFinite(cover.h)) ? cover.h : r.h;
      return {
        id: r.id,
        alt: typeof r.alt === 'string' ? r.alt : '',
        src: coverSrc,
        w: coverW,
        h: coverH,
        tags: Array.isArray(r.tags) ? r.tags : [],
        hasProducts: !!(r.links && Array.isArray(r.links.products) && r.links.products.length),
        relatedCount: (r.links && Array.isArray(r.links.related)) ? r.links.related.length : 0,
        sortKey: typeof r.sortKey === 'number' ? r.sortKey : Date.parse(r.createdAt || 0)
      };
    });
  const outPath = path.join(OUT_ROOT, 'images-index.json');
  fs.writeFileSync(outPath, JSON.stringify(slim, null, 2) + '\n', 'utf-8');
  const emptyAlt = slim.filter(x => !x.alt).length;
  console.log(`images-index: ${slim.length} items → ${outPath}`);
  console.log(`images-index: empty alt = ${emptyAlt}`);
  console.log(`images-index: top =`, slim[0]);
} catch (e) {
  console.warn('Warn: failed to write public/images-index.json', e);
}

// まとめ
const sourceHashAfter = sha256File(INDEX_SOURCE);
if (sourceHashAfter) {
  const unchanged = sourceHashBefore && sourceHashBefore === sourceHashAfter;
  const suffix = unchanged ? ' (unchanged)' : ' (! changed)';
  console.log(`[build:media] src/data/images.json sha256 (after): ${sourceHashAfter}${suffix}`);
  if (sourceHashBefore && !unchanged) {
    console.error('Error: src/data/images.json was modified during build.');
    process.exit(1);
  }
} else {
  console.log('[build:media] src/data/images.json sha256 (after): <unavailable>');
}

console.log(`\n✓ images.gen.json written (${outIndex.length} items)`);
console.log(`  → ${GENERATED_INDEX}`);
console.log(`✓ outputs: ${OUT_BASE}`);
console.log(`✓ made=${made}, skipped=${skipped}, time=${ms(pipelineDurationMs)}\n`);
