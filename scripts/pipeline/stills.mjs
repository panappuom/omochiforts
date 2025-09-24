import fg from 'fast-glob';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ulid as makeUlid } from 'ulid';

const DEFAULT_FORMATS = ['avif', 'webp'];

const isUlidLike = (s) => typeof s === 'string' && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(s);
const fileStem = (p) => path.basename(p, path.extname(p)).replace(/\s+/g, '_');
const posix = (p) => p.split(path.sep).join('/');
const ms = (t) => (t >= 1000 ? `${(t / 1000).toFixed(1)}s` : `${t}ms`);
const ensureDir = (p) => fs.mkdirSync(p, { recursive: true });

const defaultLqip = { enabled: false, size: 24, quality: 50 };

const sanitizeBasePath = (basePath) => {
  if (!basePath) return 'assets';
  const trimmed = basePath.startsWith('/') ? basePath.slice(1) : basePath;
  return trimmed || 'assets';
};

export const preferCoverSrc = (sizes) => {
  if (!sizes || typeof sizes !== 'object') return '';
  const order = [
    sizes?.s?.avif,
    sizes?.s?.webp,
    sizes?.s2x?.avif,
    sizes?.s2x?.webp,
    sizes?.l?.avif,
    sizes?.l?.webp,
    sizes?.l2x?.avif,
    sizes?.l2x?.webp,
  ];
  for (const src of order) {
    if (typeof src === 'string' && src) return src;
  }
  return '';
};

async function getMeta(inPath) {
  try {
    return await sharp(inPath).rotate().metadata();
  } catch {
    return { width: undefined, height: undefined };
  }
}

async function lqipData(inPath, options) {
  if (!options.enabled) return null;
  try {
    const buf = await sharp(inPath)
      .rotate()
      .resize({ width: options.size, withoutEnlargement: true })
      .webp({ quality: options.quality })
      .toBuffer();
    return `data:image/webp;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

async function needBuild(src, dst, rebuildIfNewer) {
  if (!fs.existsSync(dst)) return true;
  if (!rebuildIfNewer) return false;
  try {
    const [ss, ds] = await Promise.all([fs.promises.stat(src), fs.promises.stat(dst)]);
    return ss.mtimeMs > ds.mtimeMs + 1;
  } catch {
    return true;
  }
}

function makeUrlBuilder(outputDir, publicBasePath) {
  const base = sanitizeBasePath(publicBasePath);
  return (dstPath) => {
    const rel = posix(path.relative(outputDir, dstPath));
    return '/' + path.posix.join(base, rel);
  };
}

export async function runStillsPipeline(options) {
  const {
    originalsDir,
    outputDir,
    prevRecords = [],
    formats = DEFAULT_FORMATS,
    widths = {},
    quality = {},
    rebuildIfNewer = true,
    lqip: lqipInput = defaultLqip,
    publicBasePath = '/assets',
  } = options ?? {};

  if (!originalsDir) {
    throw new Error('runStillsPipeline: originalsDir is required');
  }
  if (!outputDir) {
    throw new Error('runStillsPipeline: outputDir is required');
  }

  const FORMATS = formats.map((f) => f.toLowerCase());
  const widthSmall = Number.isFinite(widths.s) ? widths.s : 236;
  const widthSmall2x = Number.isFinite(widths.s2x) ? widths.s2x : widthSmall * 2;
  const widthLarge = Number.isFinite(widths.l) ? widths.l : 1200;
  const widthLarge2x = Number.isFinite(widths.l2x) ? widths.l2x : widthLarge * 2;

  const qualitySmall = Number.isFinite(quality.small) ? quality.small : 72;
  const qualityLarge = Number.isFinite(quality.large) ? quality.large : 82;

  const lqipOptions = {
    enabled: !!lqipInput?.enabled,
    size: Number.isFinite(lqipInput?.size) ? lqipInput.size : defaultLqip.size,
    quality: Number.isFinite(lqipInput?.quality) ? lqipInput.quality : defaultLqip.quality,
  };

  const DIR_S = path.join(outputDir, 's');
  const DIR_S2 = path.join(outputDir, 's2x');
  const DIR_L = path.join(outputDir, 'l');
  const DIR_L2 = path.join(outputDir, 'l2x');

  const urlFromOut = makeUrlBuilder(outputDir, publicBasePath);

  const prevById = new Map(prevRecords.map((r) => [r.id, r]));
  const prevBySource = new Map(
    prevRecords
      .filter((r) => r && typeof r.source === 'string')
      .map((r) => [r.source, r])
  );

  const inputs = await fg(['**/*.{jpg,jpeg,png,webp,avif}'], {
    cwd: originalsDir,
    dot: false,
    onlyFiles: true,
  });

  if (!inputs.length) {
    console.log(`No source images found in ${originalsDir}`);
    return {
      records: [],
      made: 0,
      skipped: 0,
      durationMs: 0,
      inputsCount: 0,
      aborted: true,
    };
  }

  [DIR_S, DIR_S2, DIR_L, DIR_L2].forEach(ensureDir);

  const t0 = Date.now();
  const outIndex = [];
  let made = 0;
  let skipped = 0;

  for (const rel of inputs) {
    const inAbs = path.resolve(originalsDir, rel);
    const relPosix = posix(rel);
    const stem = fileStem(rel);

    let current =
      prevBySource.get(relPosix) ||
      prevById.get(stem) ||
      prevRecords.find(
        (r) =>
          r.id === stem ||
          (r.sizes?.s?.webp && typeof r.sizes.s.webp === 'string' && r.sizes.s.webp.includes(`/${stem}.webp`))
      );

    const stat = fs.statSync(inAbs);
    const meta = await getMeta(inAbs);

    const createdAt = current?.createdAt ?? new Date(stat.mtimeMs).toISOString();
    const prevCreatedAt = current?.createdAt;
    const prevSortKey = typeof current?.sortKey === 'number' ? current.sortKey : undefined;
    const createdEpoch = Date.parse(createdAt || 0);
    const sortKey = current
      ? prevCreatedAt === createdAt && typeof prevSortKey === 'number'
        ? prevSortKey
        : createdEpoch
      : createdEpoch;

    const id = current?.id ?? (isUlidLike(stem) ? stem : makeUlid(Date.parse(createdAt)));

    const outPaths = {
      s: Object.fromEntries(FORMATS.map((f) => [f, path.join(DIR_S, `${id}.${f}`)])),
      s2x: Object.fromEntries(FORMATS.map((f) => [f, path.join(DIR_S2, `${id}.${f}`)])),
      l: Object.fromEntries(FORMATS.map((f) => [f, path.join(DIR_L, `${id}.${f}`)])),
      l2x: Object.fromEntries(FORMATS.map((f) => [f, path.join(DIR_L2, `${id}.${f}`)])),
    };

    async function buildOne(width, dstMap, qualityValue) {
      for (const fmt of FORMATS) {
        const dst = dstMap[fmt];
        if (await needBuild(inAbs, dst, rebuildIfNewer)) {
          const pipe = sharp(inAbs)
            .rotate()
            .resize({ width, height: width, fit: 'inside', withoutEnlargement: true });
          if (fmt === 'avif') await pipe.avif({ quality: qualityValue }).toFile(dst);
          else if (fmt === 'webp') await pipe.webp({ quality: qualityValue }).toFile(dst);
          else throw new Error(`Unsupported format: ${fmt}`);
          made++;
        } else {
          skipped++;
        }
      }
    }

    await buildOne(widthSmall, outPaths.s, qualitySmall);
    await buildOne(widthSmall2x, outPaths.s2x, qualitySmall);
    await buildOne(widthLarge, outPaths.l, qualityLarge);
    await buildOne(widthLarge2x, outPaths.l2x, qualityLarge);

    const urls = {
      s: Object.fromEntries(
        FORMATS.map((f) => [f, urlFromOut(path.join(outputDir, 's', `${id}.${f}`))])
      ),
      s2x: Object.fromEntries(
        FORMATS.map((f) => [f, urlFromOut(path.join(outputDir, 's2x', `${id}.${f}`))])
      ),
      l: Object.fromEntries(
        FORMATS.map((f) => [f, urlFromOut(path.join(outputDir, 'l', `${id}.${f}`))])
      ),
      l2x: Object.fromEntries(
        FORMATS.map((f) => [f, urlFromOut(path.join(outputDir, 'l2x', `${id}.${f}`))])
      ),
    };

    const lqipValue = await lqipData(inAbs, lqipOptions);

    const keep = current ?? {};
    const kind = typeof keep.kind === 'string' && keep.kind ? keep.kind : 'image';
    const prevAssetsRaw = Array.isArray(keep.assets)
      ? keep.assets.filter((a) => a && typeof a === 'object')
      : [];
    const matchedAsset = prevAssetsRaw.find(
      (a) =>
        (typeof a.id !== 'undefined' && String(a.id) === String(id)) ||
        (typeof a.source === 'string' && a.source === relPosix)
    );
    const assetId = matchedAsset && typeof matchedAsset.id === 'string' && matchedAsset.id ? matchedAsset.id : id;
    const imageAsset = {
      id: assetId,
      kind: 'image',
      source: relPosix,
      w: meta.width,
      h: meta.height,
      lqip: lqipValue,
      sizes: urls,
    };
    let assets = [];
    if (kind === 'image') {
      let replaced = false;
      assets = prevAssetsRaw.map((a) => {
        if (
          !replaced &&
          ((typeof a.id !== 'undefined' && String(a.id) === String(imageAsset.id)) ||
            (typeof a.source === 'string' && a.source === relPosix))
        ) {
          replaced = true;
          return {
            ...a,
            ...imageAsset,
            sizes: imageAsset.sizes,
            w: imageAsset.w,
            h: imageAsset.h,
            lqip: imageAsset.lqip,
            source: imageAsset.source,
          };
        }
        return { ...a };
      });
      if (!replaced) assets.push(imageAsset);
    } else {
      assets = prevAssetsRaw.length ? prevAssetsRaw.map((a) => ({ ...a })) : [imageAsset];
    }

    const defaultCover = {
      kind: 'image',
      assetId: imageAsset.id,
      src: preferCoverSrc(urls),
      w: meta.width,
      h: meta.height,
      lqip: lqipValue,
      sizes: urls,
    };
    const prevCover = keep.cover && typeof keep.cover === 'object' ? keep.cover : null;
    let cover;
    if (kind === 'image') {
      cover = { ...(prevCover ?? {}), ...defaultCover, sizes: defaultCover.sizes };
    } else if (prevCover) {
      cover = { ...prevCover };
      if (!('src' in cover) || !cover.src) cover.src = defaultCover.src;
      if (!('kind' in cover) || !cover.kind) cover.kind = defaultCover.kind;
      if (!('assetId' in cover) && defaultCover.assetId) cover.assetId = defaultCover.assetId;
      if (!('sizes' in cover) && defaultCover.sizes) cover.sizes = defaultCover.sizes;
      if (!('w' in cover) && Number.isFinite(defaultCover.w)) cover.w = defaultCover.w;
      if (!('h' in cover) && Number.isFinite(defaultCover.h)) cover.h = defaultCover.h;
      if (!('lqip' in cover) && defaultCover.lqip) cover.lqip = defaultCover.lqip;
    } else {
      cover = defaultCover;
    }

    const record = {
      id,
      kind,
      source: relPosix,
      title: keep.title ?? '',
      alt: keep.alt ?? '',
      series: keep.series ?? [],
      characters: keep.characters ?? [],
      tags: keep.tags ?? [],
      createdAt,
      sortKey,
      w: meta.width,
      h: meta.height,
      lqip: lqipValue,
      sizes: urls,
      cover,
      assets,
      caption: keep.caption ?? '',
      links: keep.links ?? { products: [], related: [] },
    };

    outIndex.push(record);
  }

  outIndex.sort((a, b) => {
    const sa = typeof a.sortKey === 'number' ? a.sortKey : Date.parse(a.createdAt || 0);
    const sb = typeof b.sortKey === 'number' ? b.sortKey : Date.parse(b.createdAt || 0);
    if (sa !== sb) return sa - sb;
    return String(a.id).localeCompare(String(b.id));
  });

  const durationMs = Date.now() - t0;
  console.log(
    `[pipeline:stills] processed ${inputs.length} inputs → made=${made}, skipped=${skipped}, time=${ms(
      durationMs
    )}`
  );

  return { records: outIndex, made, skipped, durationMs, inputsCount: inputs.length };
}
