function ensure(el, sel, html){
    const n = el.querySelector(sel);
    if (n) return n;
    el.insertAdjacentHTML('beforeend', html);
    return el.querySelector(sel);
  }
  
  function applyConfig(el){
    const side = el.getAttribute('side') || 'left';
    el.dataset.peek = side;
  
    const set = (name, def) => el.style.setProperty(name, (el.getAttribute(name.replace('--','')) || el.getAttribute(name) || def) + (String(def).endsWith('px') ? '' : 'px'));
    // サイズ・座標（kebab属性 or styleでもOK）
    set('--peek-w', 110); set('--peek-h', 110);
    set('--emo-x', 16);  set('--emo-y', -4);
    set('--emo-w', 28);  set('--emo-h', 28);
  
    // 画像アサイン（属性 > 既存）
    const body = el.querySelector('.peek-body');
    const hand = el.querySelector('.peek-hand');
    const eye  = el.querySelector('.peek-eye');
    if (el.getAttribute('body-src')) body.src = el.getAttribute('body-src');
    if (el.getAttribute('hand-src')) hand.src = el.getAttribute('hand-src');
    if (el.getAttribute('eye-open')) eye.dataset.open  = el.getAttribute('eye-open');
    if (el.getAttribute('eye-close')) eye.dataset.close = el.getAttribute('eye-close');
    eye.src = eye.dataset.open || eye.src;
  
    // sideがleftのときはヒットを左へ
    const hit = el.querySelector('.peek-hit');
    if (side === 'left'){ hit.style.left = '0'; hit.style.right = 'auto'; }
  }
  
  function attachBehavior(el){
    const eye = el.querySelector('.peek-eye');
    const hit = el.querySelector('.peek-hit');
  
    el.addEventListener('mouseenter', () => el.classList.add('is-peeking'));
    el.addEventListener('mouseleave', () => el.classList.remove('is-peeking'));
  
    hit.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      el.classList.toggle('is-peeking');
    });
  
    // 瞬き（出ている間だけ）
    let t1=null, t2=null;
    const open = () => eye.src = eye.dataset.open;
    const close = () => eye.src = eye.dataset.close || eye.dataset.open;
  
    const schedule = () => {
      t1 = setTimeout(()=>{ close(); t2=setTimeout(()=>{ open(); schedule(); }, 120); }, 3000 + Math.random()*2500);
    };
    const refresh = () => { clearTimeout(t1); clearTimeout(t2); if (el.classList.contains('is-peeking')) schedule(); };
  
    el.addEventListener('mouseenter', refresh);
    el.addEventListener('mouseleave', refresh);
    document.addEventListener('visibilitychange', ()=>{ if(document.hidden){clearTimeout(t1);clearTimeout(t2);} else refresh(); });
  
    if (el.classList.contains('is-peeking')) schedule();
  }
  
  export function initPeekAgents(root=document){
    root.querySelectorAll('peek-agent').forEach(el=>{
      if (el.dataset.peekInited) return;
      el.dataset.peekInited = '1';
  
      // 必須要素を用意（カードはスロット＝ユーザー側で入れる）
      ensure(el, '.peek-body', `<img class="peek-body" alt="" aria-hidden="true">`);
      ensure(el, '.peek-hand', `<img class="peek-hand" alt="" aria-hidden="true">`);
      ensure(el, '.peek-eye',  `<img class="peek-eye"  alt="" aria-hidden="true">`);
      ensure(el, '.peek-hit',  `<button class="peek-hit" type="button" aria-label="toggle"></button>`);
  
      applyConfig(el);
      attachBehavior(el);
    });
  }
  
  if (typeof window !== 'undefined'){
    window.addEventListener('DOMContentLoaded', () => initPeekAgents());
  }
  