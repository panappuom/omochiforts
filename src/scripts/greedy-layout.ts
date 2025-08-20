// /scripts/greedy-layout.ts
type Opts = {
    minCols: number;          // 最小列数
    maxCols: number;          // 最大列数
    minWidth: number;         // サムネ最小幅(px) これから列数を決める
    gapX?: number;            // 横ギャップ（CSS変数 --gx が優先）
    gapY?: number;            // 縦ギャップ（CSS変数 --gy が優先）
    debounceMs?: number;      // リサイズのデバウンス
  };
  
  export function setupGreedy(root: HTMLElement, opts: Opts) {
    // CSS変数からギャップ取得（無ければオプション→デフォルト）
    const getGaps = () => {
      const cs = getComputedStyle(root);
      const gx = parseInt(cs.getPropertyValue("--gx")) || opts.gapX || 12;
      const gy = parseInt(cs.getPropertyValue("--gy")) || opts.gapY || 10;
      return { gx, gy };
    };
  
    const items = Array.from(root.querySelectorAll<HTMLElement>(".card"));
  
    // 画像寸法の取得（data-w/h 優先、なければ naturalWidth/Height）
    const getWH = (card: HTMLElement) => {
      const img = card.querySelector("img") as HTMLImageElement | null;
      const w = Number((card as any).dataset?.w) || img?.naturalWidth || 1;
      const h = Number((card as any).dataset?.h) || img?.naturalHeight || 1;
      return { w, h };
    };
  
    // 列数の決定（コンテナ幅、最小幅、ギャップから算出）
    const computeCols = (width: number, gx: number) => {
      // 列間は (cols - 1) 箇所あるので、実効幅 = width - gx*(cols-1)
      // 実効幅/cols >= minWidth を満たす最大の cols を求める
      const maxByWidth = Math.max(
        1,
        Math.floor((width + gx) / (opts.minWidth + gx))
      );
      return Math.max(opts.minCols, Math.min(opts.maxCols, maxByWidth));
    };
  
    // レイアウト本体
    const layout = () => {
      const { gx, gy } = getGaps();
      const W = root.clientWidth; // padding 込みでOK（絶対配置で合わせる）
      const cols = computeCols(W, gx);
  
      // カラム幅（列間ギャップ控除）
      const colW = Math.floor((W - gx * (cols - 1)) / cols);
  
      // 初回に Greedy 有効化クラスを付与
      if (!root.classList.contains("is-greedy-ready")) {
        root.classList.add("is-greedy-ready");
      }
  
      // 各列の現在高
      const heights = new Array<number>(cols).fill(0);
  
      // 各アイテムを最も低い列に順次配置（classic greedy）
      for (const card of items) {
        const { w, h } = getWH(card);
        const outH = Math.round(colW * (h / w));
  
        // 一番低い列を探す
        let c = 0;
        for (let i = 1; i < cols; i++) if (heights[i] < heights[c]) c = i;
  
        const x = c * (colW + gx);
        const y = heights[c];
  
        // 配置
        (card.style as any).transform = `translate(${x}px, ${y}px)`;
        (card.style as any).width = `${colW}px`;
  
        // 列の高さを更新（アイテム高 + 縦ギャップ）
        heights[c] = y + outH + gy;
      }
  
      // コンテナの高さを最大列高に合わせる
      (root.style as any).height = `${Math.max(...heights) - gy}px`;
    };
  
    // ---- リサイズ監視（デバウンス）----
    let t = 0;
    const debounce = () => {
      if (t) clearTimeout(t);
      t = window.setTimeout(layout, opts.debounceMs ?? 80);
    };
  
    const ro = new ResizeObserver(debounce);
    ro.observe(root);
  
    // 画像ロードで naturalWidth/Height が出揃ってから再配置
    const imgs = root.querySelectorAll("img");
    imgs.forEach(img => {
      if ((img as HTMLImageElement).complete) return;
      img.addEventListener("load", debounce, { once: true });
      img.addEventListener("error", debounce, { once: true });
    });
  
    // 初期配置
    layout();
  
    return {
      destroy() {
        ro.disconnect();
        window.clearTimeout(t);
      },
    };
  }
  