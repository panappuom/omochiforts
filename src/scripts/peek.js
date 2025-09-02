// カード横「ニュッ」＋瞬き制御
export function initPeek(selector = '.card-wrap'){
    document.querySelectorAll(selector).forEach((wrap) => {
      const side = wrap.dataset.peek || 'right';
      const body = wrap.querySelector('.peek-body');
      const hand = wrap.querySelector('.peek-hand');
      const eye  = wrap.querySelector('.peek-eye');
      const hit  = wrap.querySelector('.peek-hit');
  
      if(!body || !hand || !eye || !hit) return;
  
      // 左側から出す場合、ヒットエリアを左へ
      if(side === 'left'){
        hit.style.left = '0';
        hit.style.right = 'auto';
      }
  
      // 初期は出っぱなしにしたい？ → 好みで
      // wrap.classList.add('is-peeking');
  
      // ホバーでニュッ／離れてスッ（タッチ環境ではクリック優先）
      wrap.addEventListener('mouseenter', () => wrap.classList.add('is-peeking'));
      wrap.addEventListener('mouseleave', () => wrap.classList.remove('is-peeking'));
  
      // クリックでトグル（出ていたら引っ込む）
      hit.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        wrap.classList.toggle('is-peeking');
        // ついでに「驚き」表情を入れたければここで eye 差し替え等
      });
  
      // --- 瞬き（CSS/JS切替版） ---
      const openSrc  = eye.dataset.open;
      const closeSrc = eye.dataset.close;
      let blinkTimer = null, closeTimer = null;
  
      const scheduleBlink = () => {
        const wait = 3000 + Math.random()*2500; // 3.0〜5.5秒
        blinkTimer = setTimeout(() => {
          eye.src = closeSrc;
          closeTimer = setTimeout(() => {
            eye.src = openSrc;
            scheduleBlink();
          }, 120); // 閉じ時間
        }, wait);
      };
  
      // 出ている時だけ瞬きしたい場合は以下のように：
      const observePeek = () => {
        clearTimeout(blinkTimer); clearTimeout(closeTimer);
        if(wrap.classList.contains('is-peeking')) scheduleBlink();
      };
      wrap.addEventListener('mouseenter', observePeek);
      wrap.addEventListener('mouseleave', observePeek);
  
      // ページ入場時：出ていたら瞬き開始
      if(wrap.classList.contains('is-peeking')) scheduleBlink();
  
      // 省エネ：タブ非表示で停止
      document.addEventListener('visibilitychange', () => {
        if(document.hidden){ clearTimeout(blinkTimer); clearTimeout(closeTimer); }
        else if(wrap.classList.contains('is-peeking')) scheduleBlink();
      });
    });
  }
  
  // 自動初期化（ESMを直接読み込む場合）
  if (typeof window !== 'undefined'){
    window.addEventListener('DOMContentLoaded', () => initPeek());
  }
  