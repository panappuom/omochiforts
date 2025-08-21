// scripts/build-images.mjs
// 元画像: src/originals/<slug>/*.{jpg,jpeg,png,webp}
// 出力:   src/assets/<slug>/<name>_<width>x.webp （small/large）
// ついでに src/data/images.json を生成。
// 参考: 現在の手元版に最小差分で統合（config連動/LQIP/パス整形/ID統一）

import fg from 'fast-glob';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

// Node18でもJSONを読めるように createRequire でconfig取得
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const cfg = require('../src/config/site.config.json');

const {
  images: {
    smallWidth,
    largeWidth,
    qualitySmall,
    qualityLarge,
    rebuildIfNewer,
  },
  gallery,
} = cfg;

const SRC = 'src/originals';
const OUT_BASE = cfg.images?.outputDir || 'public/assets';
const INDEX = 'src/data/images.json';

// config反映
const S_WIDTH = smallWidth; // 例: 236
const L_WIDTH = largeWidth; // 例: 1200
const REBUILD_IF_NEWER = rebuildIfNewer;
const LQIP_ENABLED = !!gallery?.lqip;
const LQIP_SIZE = 24; // 小さなdataURI用

// ---------- helpers ----------
const hr = () => console.log(''.padEnd(40, '-'));
const ms = (t) => {
  const s = t / 1000;
  return s >= 1 ? `${s.toFixed(1)}s` : `${t}ms`;
};
const toParts = (rel) => rel.replaceAll('\\', '/').split('/');
const mtime = async (p) => (await fs.promises.stat(p)).mtimeMs;

// ---------- 収集 ----------
const allFiles = await fg(['**/*.{jpg,jpeg,png,webp}'], {
  cwd: SRC,
  dot: false,
});

// slug => [rel, ...]
const bySlug = new Map();
for (const rel of allFiles) {
  const [slug] = toParts(rel);
  if (!bySlug.has(slug)) bySlug.set(slug, []);
  bySlug.get(slug).push(rel);
}

const index = [];
const t0All = Date.now();
let totalMade = 0;
let totalSkip = 0;
let totalSlugFastSkipped = 0;

// ---------- メイン処理 ----------
for (const [slug, rels] of [...bySlug.entries()].sort()) {
  const t0 = Date.now();
  const outDir = path.join(OUT_BASE, slug);
  const stamp = path.join(outDir, `.stamp_${S_WIDTH}x_${L_WIDTH}x`);

  // === slug まるごとスキップ判定 ===
  if (fs.existsSync(outDir) && fs.existsSync(stamp)) {
    // originals側の最新更新時刻
    const inPaths = rels.map((r) => path.join(SRC, r));
    const stats = await Promise.allSettled(
      inPaths.map((p) => fs.promises.stat(p))
    );
    const latestOrigMtime = Math.max(
      ...stats
        .filter((r) => r.status === 'fulfilled')
        .map((r) => r.value.mtimeMs),
      0
    );
    const stStamp = await fs.promises.stat(stamp).catch(() => null);

    // 出力枚数チェック（足りなかったら作り直し）
    const smallOuts = await fg([`${slug}/*_${S_WIDTH}x.webp`], {
      cwd: OUT_BASE,
    });
    const largeOuts = await fg([`${slug}/*_${L_WIDTH}x.webp`], {
      cwd: OUT_BASE,
    });

    if (
      stStamp &&
      stStamp.mtimeMs >= latestOrigMtime &&
      smallOuts.length >= rels.length &&
      largeOuts.length >= rels.length
    ) {
      console.log(`⏭ [${slug}] fast-skip (${rels.length}枚)`);
      totalSlugFastSkipped++;
      // ★ Fast-skip でも index は構築する（既存出力を前提）
      for (const rel of rels) {
        const inPath = path.join(SRC, rel);
        const fileBase = path
          .basename(rel, path.extname(rel))
          .replaceAll(' ', '_');

        const outSName = `${fileBase}_${S_WIDTH}x.webp`;
        const outLName = `${fileBase}_${L_WIDTH}x.webp`;

        // メタは元画像から取得（生成はしない）
        let meta;
        try {
          const probe = sharp(inPath).rotate();
          meta = await probe.metadata();
        } catch {
          meta = { width: undefined, height: undefined };
        }

        // 必要ならLQIPもここで生成（軽量）
        let lqip = null;
        if (LQIP_ENABLED) {
          try {
            const buf = await sharp(inPath)
              .rotate()
              .resize({ width: LQIP_SIZE, withoutEnlargement: true })
              .webp({ quality: 50 })
              .toBuffer();
            lqip = `data:image/webp;base64,${buf.toString('base64')}`;
          } catch {}
        }

        const sPath = `/${path.posix.join('assets', slug, outSName)}`;
        const lPath = `/${path.posix.join('assets', slug, outLName)}`;

        index.push({
          id: `${slug}/${fileBase}`,
          slug,
          name: fileBase,
          s: sPath,
          l: lPath,
          w: meta.width,
          h: meta.height,
          lqip,
        });
      }
      continue; // 生成はスキップだが index は維持
    }
  }

  // === 通常処理（ファイル単位スキップも併用） ===
  await fs.promises.mkdir(outDir, { recursive: true });

  let made = 0;
  let skip = 0;

  for (const rel of rels) {
    const inPath = path.join(SRC, rel);
    const fileBase = path.basename(rel, path.extname(rel)).replaceAll(' ', '_');

    const outSName = `${fileBase}_${S_WIDTH}x.webp`;
    const outLName = `${fileBase}_${L_WIDTH}x.webp`;
    const outS = path.join(outDir, outSName);
    const outL = path.join(outDir, outLName);

    const needBuild = async (src, dst) => {
      if (!fs.existsSync(dst)) return true;
      if (!REBUILD_IF_NEWER) return false;
      try {
        const [stSrc, stDst] = await Promise.all([
          fs.promises.stat(src),
          fs.promises.stat(dst),
        ]);
        return stSrc.mtimeMs > stDst.mtimeMs;
      } catch {
        return true;
      }
    };

    const doSmall = await needBuild(inPath, outS);
    const doLarge = await needBuild(inPath, outL);

    let img, meta;
    if (doSmall || doLarge) {
      img = sharp(inPath).rotate();
      meta = await img.metadata();
    }

    if (doSmall) {
      await img
        .clone()
        .resize({ width: S_WIDTH, withoutEnlargement: true })
        .webp({ quality: qualitySmall })
        .toFile(outS);
      made++;
    } else {
      skip++;
    }

    if (doLarge) {
      await img
        .clone()
        .resize({ width: L_WIDTH, withoutEnlargement: true })
        .webp({ quality: qualityLarge })
        .toFile(outL);
      made++;
    } else {
      skip++;
    }

    if (!meta) {
      const probe = sharp(inPath).rotate();
      meta = await probe.metadata();
    }

    // LQIP 生成（dataURI）
    let lqip = null;
    if (LQIP_ENABLED) {
      try {
        const buf = await sharp(inPath)
          .rotate()
          .resize({ width: LQIP_SIZE, withoutEnlargement: true })
          .webp({ quality: 50 })
          .toBuffer();
        lqip = `data:image/webp;base64,${buf.toString('base64')}`;
      } catch {}
    }

    // /src/assets → /assets に変換（配信用）
    const sPath = `/${path.posix.join('assets', slug, outSName)}`;
    const lPath = `/${path.posix.join('assets', slug, outLName)}`;

    index.push({
      id: `${slug}/${fileBase}`, // UI側と整合するID
      slug,
      name: fileBase,
      s: sPath,
      l: lPath,
      w: meta.width,
      h: meta.height,
      lqip,
    });
  }

  // slugのスタンプを更新（現在時刻を反映）
  try {
    await fs.promises.writeFile(
      stamp,
      `built ${new Date().toISOString()}\n`,
      'utf-8'
    );
  } catch {}

  totalMade += made;
  totalSkip += skip;
  console.log(
    `✓ [${slug}] 生成 ${made} / スキップ ${skip} (${rels.length}枚) ${ms(
      Date.now() - t0
    )}`
  );
}

hr();
// 画像の並び: slug降順（新しいフォルダが新しいと仮定）→ name昇順
index.sort((a, b) =>
  a.slug === b.slug
    ? a.name.localeCompare(b.name)
    : b.slug.localeCompare(a.slug)
);

await fs.promises.mkdir(path.dirname(INDEX), { recursive: true });
await fs.promises.writeFile(INDEX, JSON.stringify(index, null, 2), 'utf-8');

console.log(
  `Done. slugs=${bySlug.size}, images=${
    allFiles.length
  }, made=${totalMade}, skipped=${totalSkip}, fastSkipped=${totalSlugFastSkipped} slugs, time=${ms(
    Date.now() - t0All
  )}`
);
