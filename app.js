// 無音カメラ — カメラ映像のフレームを静止画として保存する（シャッター音なし）
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

  // ================= 設定 =================
  const DEFAULTS = {
    saveMode: 'each', quality: '1', location: true, grid: false, level: false, mirror: false,
    videoRes: '1080', videoFps: '30', audio: true,
    aspect: '4:3', timer: 0, filter: 'none', flash: false, mode: 'photo', facing: 'back', lens: 'wide',
  };
  const S = Object.assign({}, DEFAULTS, (() => { try { return JSON.parse(localStorage.getItem('silentcam.settings')) || {}; } catch { return {}; } })());
  const saveSettings = () => { try { localStorage.setItem('silentcam.settings', JSON.stringify(S)); } catch {} };

  // ================= フィルタ =================
  const FILTERS = [
    ['none', 'オリジナル', ''],
    ['vivid', 'ビビッド', 'saturate(1.35) contrast(1.08)'],
    ['vividWarm', 'ビビッド(暖)', 'saturate(1.3) contrast(1.08) sepia(0.18)'],
    ['vividCool', 'ビビッド(冷)', 'saturate(1.25) contrast(1.08) hue-rotate(-10deg) brightness(1.02)'],
    ['dramatic', 'ドラマチック', 'contrast(1.3) saturate(0.85) brightness(0.95)'],
    ['dramaticWarm', 'ドラマチック(暖)', 'contrast(1.3) saturate(0.9) sepia(0.22) brightness(0.95)'],
    ['dramaticCool', 'ドラマチック(冷)', 'contrast(1.3) saturate(0.85) hue-rotate(-14deg) brightness(0.95)'],
    ['mono', 'モノ', 'grayscale(1)'],
    ['silver', 'シルバートーン', 'grayscale(1) contrast(1.15) brightness(1.05)'],
    ['noir', 'ノアール', 'grayscale(1) contrast(1.6) brightness(0.9)'],
  ];
  const filterCss = (id) => (FILTERS.find((f) => f[0] === id) || FILTERS[0])[2];
  const CTX_FILTER = 'filter' in CanvasRenderingContext2D.prototype;

  // ctx.filter 非対応のSafari向け：CSSフィルタ関数を色行列に合成して画素処理
  function cssToMatrix(css) {
    let M = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]];
    const re = /([a-z-]+)\(([-\d.]+)(deg|%)?\)/g; let m;
    while ((m = re.exec(css))) {
      let a = parseFloat(m[2]); if (m[3] === '%') a /= 100;
      let op;
      if (m[1] === 'grayscale' || m[1] === 'sepia' || m[1] === 'saturate') {
        const g = 1 - a, s = a;
        op = m[1] === 'grayscale' ? [[.2126 + .7874 * g, .7152 - .7152 * g, .0722 - .0722 * g], [.2126 - .2126 * g, .7152 + .2848 * g, .0722 - .0722 * g], [.2126 - .2126 * g, .7152 - .7152 * g, .0722 + .9278 * g]]
          : m[1] === 'sepia' ? [[.393 + .607 * g, .769 - .769 * g, .189 - .189 * g], [.349 - .349 * g, .686 + .314 * g, .168 - .168 * g], [.272 - .272 * g, .534 - .534 * g, .131 + .869 * g]]
          : [[.213 + .787 * s, .715 - .715 * s, .072 - .072 * s], [.213 - .213 * s, .715 + .285 * s, .072 - .072 * s], [.213 - .213 * s, .715 - .715 * s, .072 + .928 * s]];
        op = op.map((r) => [...r, 0]);
      } else if (m[1] === 'hue-rotate') {
        const t = a * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
        op = [[.213 + c * .787 - s * .213, .715 - c * .715 - s * .715, .072 - c * .072 + s * .928, 0],
          [.213 - c * .213 + s * .143, .715 + c * .285 + s * .140, .072 - c * .072 - s * .283, 0],
          [.213 - c * .213 - s * .787, .715 - c * .715 + s * .715, .072 + c * .928 + s * .072, 0]];
      } else if (m[1] === 'brightness') {
        op = [[a, 0, 0, 0], [0, a, 0, 0], [0, 0, a, 0]];
      } else if (m[1] === 'contrast') {
        const o = .5 - .5 * a; op = [[a, 0, 0, o], [0, a, 0, o], [0, 0, a, o]];
      } else continue;
      const R = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 4; j++) {
          R[i][j] = op[i][0] * M[0][j] + op[i][1] * M[1][j] + op[i][2] * M[2][j] + (j === 3 ? op[i][3] : 0);
        }
      }
      M = R;
    }
    return M;
  }
  function applyMatrix(ctx, w, h, M) {
    const band = 256; // メモリ節約のため帯状に処理
    for (let y = 0; y < h; y += band) {
      const bh = Math.min(band, h - y);
      const img = ctx.getImageData(0, y, w, bh); const d = img.data;
      const o0 = M[0][3] * 255, o1 = M[1][3] * 255, o2 = M[2][3] * 255;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        d[i] = M[0][0] * r + M[0][1] * g + M[0][2] * b + o0;
        d[i + 1] = M[1][0] * r + M[1][1] * g + M[1][2] * b + o1;
        d[i + 2] = M[2][0] * r + M[2][1] * g + M[2][2] * b + o2;
      }
      ctx.putImageData(img, 0, y);
    }
  }

  // ================= IndexedDB =================
  const DB = {
    db: null,
    open() {
      return this.db ? Promise.resolve(this.db) : new Promise((res, rej) => {
        const r = indexedDB.open('silentcam', 1);
        r.onupgradeneeded = () => { r.result.createObjectStore('items', { keyPath: 'id' }); r.result.createObjectStore('blobs'); };
        r.onsuccess = () => { this.db = r.result; res(this.db); };
        r.onerror = () => rej(r.error);
      });
    },
    async run(stores, mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const tx = db.transaction(stores, mode); let out;
        Promise.resolve(fn(tx, (v) => { out = v; })).catch(rej);
        tx.oncomplete = () => res(out); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
      });
    },
    add(meta, blob) { return this.run(['items', 'blobs'], 'readwrite', (tx) => { tx.objectStore('items').put(meta); tx.objectStore('blobs').put(blob, meta.id); }); },
    put(meta) { return this.run(['items'], 'readwrite', (tx) => { tx.objectStore('items').put(meta); }); },
    del(id) { return this.run(['items', 'blobs'], 'readwrite', (tx) => { tx.objectStore('items').delete(id); tx.objectStore('blobs').delete(id); }); },
    all() { return this.run(['items'], 'readonly', (tx, set) => { const r = tx.objectStore('items').getAll(); r.onsuccess = () => set(r.result); }); },
    blob(id) { return this.run(['blobs'], 'readonly', (tx, set) => { const r = tx.objectStore('blobs').get(id); r.onsuccess = () => set(r.result); }); },
  };

  // ================= 要素 =================
  const video = $('#video'), finder = $('#finder'), shutter = $('#shutter');
  let stream = null, track = null, caps = {}, devices = [], zoom = 1, hwZoom = false;
  let busy = false, recorder = null, recChunks = [], recTimer = null, recStart = 0;
  let lastGeo = null, geoWatch = null;
  let items = []; const thumbUrls = new Map();
  let idSeq = 0;

  // ================= カメラ =================
  function classify(label) {
    const l = (label || '').toLowerCase();
    if (/前面|front|facetime|user/.test(l)) return 'front';
    if (/デュアル|トリプル|dual|triple/.test(l)) return null; // 仮想マルチカメラは使わない
    if (/超広角|ultra ?wide/.test(l)) return 'ultra';
    if (/望遠|telephoto/.test(l)) return 'tele';
    if (/背面|back|rear|environment/.test(l)) return 'wide';
    return null;
  }
  async function refreshDevices() {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      devices = list.filter((d) => d.kind === 'videoinput').map((d) => ({ id: d.deviceId, label: d.label, kind: classify(d.label) }));
    } catch { devices = []; }
  }
  function pickDeviceId() {
    const kind = S.facing === 'front' ? 'front' : (S.lens || 'wide');
    const d = devices.find((x) => x.kind === kind) || (S.facing !== 'front' && devices.find((x) => x.kind === 'wide'));
    return d ? d.id : null;
  }
  const isFront = () => {
    const fm = track && track.getSettings && track.getSettings().facingMode;
    return fm ? fm === 'user' : S.facing === 'front';
  };
  function stopStream() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null; track = null;
  }

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('このブラウザではカメラを使えません（HTTPSで開いているか確認してください）');
    }
    stopStream();
    const isVideo = S.mode === 'video';
    const v = {};
    if (isVideo) {
      const [w, h] = S.videoRes === '4k' ? [3840, 2160] : [1920, 1080];
      Object.assign(v, { width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: +S.videoFps } });
    } else {
      Object.assign(v, { width: { ideal: 4032 }, height: { ideal: 3024 } });
    }
    const facing = { facingMode: S.facing === 'front' ? 'user' : 'environment' };
    const devId = pickDeviceId();
    const wantAudio = isVideo && S.audio;
    const attempts = [];
    if (devId) attempts.push({ video: { ...v, deviceId: { exact: devId } }, audio: wantAudio });
    attempts.push({ video: { ...v, ...facing }, audio: wantAudio });
    if (wantAudio) attempts.push({ video: { ...v, ...facing }, audio: false });
    let err;
    for (const c of attempts) {
      try { stream = await navigator.mediaDevices.getUserMedia(c); break; } catch (e) { err = e; if (e.name === 'NotAllowedError' && !c.audio) break; }
    }
    if (!stream) throw err;
    if (wantAudio && !stream.getAudioTracks().length) showToast(null, 'マイクが使えないため音声なしで録画します');
    track = stream.getVideoTracks()[0];

    // 写真モードは取得可能な最大解像度まで引き上げる
    if (!isVideo && track.getCapabilities) {
      try {
        const c = track.getCapabilities(), s = track.getSettings();
        if (c.width && c.height && c.width.max * c.height.max > (s.width || 0) * (s.height || 0)) {
          await track.applyConstraints({ width: { ideal: c.width.max }, height: { ideal: c.height.max } });
        }
      } catch {}
    }
    caps = (track.getCapabilities && track.getCapabilities()) || {};
    hwZoom = !!(caps.zoom && caps.zoom.max > caps.zoom.min);
    zoom = hwZoom ? Math.max(1, caps.zoom.min) : 1;

    video.srcObject = stream;
    await new Promise((r) => { if (video.readyState >= 1 && video.videoWidth) r(); else video.onloadedmetadata = () => r(); });
    try { await video.play(); } catch {}
    if (!devices.length || devices.every((d) => !d.label)) await refreshDevices();

    track.addEventListener('ended', () => { if (document.visibilityState === 'visible') restartSoon(); });
    if (S.flash && S.mode === 'video' && caps.torch && !isFront()) setTorch(true);
    fitFinder(); applyPreview(); buildLensRow(); updateTopbar(); updateInfo();
  }
  let restartTimer = null;
  function restartSoon() {
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => startCamera().catch(showError), 300);
  }

  const portraitVideo = () => (video.videoWidth ? video.videoHeight > video.videoWidth : innerHeight > innerWidth);
  function targetRatio() { // ファインダー・保存画像の 幅/高さ
    if (S.mode === 'video') return video.videoWidth ? video.videoWidth / video.videoHeight : (portraitVideo() ? 9 / 16 : 16 / 9);
    const [a, b] = S.aspect.split(':').map(Number);
    return portraitVideo() ? b / a : a / b;
  }
  function fitFinder() {
    const st = $('#stage'); const W = st.clientWidth, H = st.clientHeight; const r = targetRatio();
    let w = W, h = W / r; if (h > H) { h = H; w = H * r; }
    finder.style.width = `${Math.floor(w)}px`; finder.style.height = `${Math.floor(h)}px`;
  }
  function applyPreview() {
    const m = isFront() ? -1 : 1; const z = hwZoom ? 1 : zoom;
    video.style.transform = `scale(${m * z}, ${z})`;
    video.style.filter = S.mode === 'photo' ? filterCss(S.filter) : '';
    const badge = $('#zoomBadge');
    const shown = hwZoom ? zoom : zoom;
    badge.textContent = `${shown.toFixed(1)}×`;
    badge.hidden = Math.abs(shown - 1) < 0.05;
  }

  let zoomPending = null, zoomRaf = 0;
  function setZoom(z) {
    if (hwZoom) {
      zoom = clamp(z, caps.zoom.min, Math.min(caps.zoom.max, 15));
      zoomPending = zoom;
      if (!zoomRaf) {
        zoomRaf = requestAnimationFrame(async () => {
          zoomRaf = 0; const val = zoomPending;
          try { await track.applyConstraints({ advanced: [{ zoom: val }] }); } catch {}
        });
      }
    } else {
      zoom = S.mode === 'video' ? 1 : clamp(z, 1, 8);
    }
    applyPreview(); markLens();
  }

  async function setTorch(on) {
    if (!track || !caps.torch) return;
    try { await track.applyConstraints({ advanced: [{ torch: on }] }); } catch {}
  }
  const flashAvailable = () => (isFront() ? S.mode === 'photo' : !!caps.torch);

  // ================= UI: 上部・レンズ =================
  function updateTopbar() {
    const fa = flashAvailable();
    $('#btnFlash').hidden = !fa;
    $('#btnFlash').classList.toggle('on', S.flash);
    $('#flashLabel').textContent = S.flash ? (S.mode === 'video' ? 'ライト' : 'オン') : 'オフ';
    $('#btnTimer').hidden = S.mode !== 'photo';
    $('#btnTimer').classList.toggle('on', !!S.timer);
    $('#timerLabel').textContent = S.timer ? `${S.timer}秒` : 'オフ';
    $('#btnAspect').hidden = S.mode !== 'photo';
    $('#aspectLabel').textContent = S.aspect;
    $('#btnFilter').hidden = S.mode !== 'photo';
    $('#btnFilter').classList.toggle('on', S.filter !== 'none');
    if (S.mode !== 'photo') $('#filterStrip').hidden = true;
    $('#grid').hidden = !S.grid;
    $$('#modeRow button').forEach((b) => b.classList.toggle('on', b.dataset.mode === S.mode));
    shutter.classList.toggle('video', S.mode === 'video');
    setLocBadge();
  }

  function buildLensRow() {
    const row = $('#lensRow'); row.innerHTML = '';
    const add = (label, fn, key) => { const b = document.createElement('button'); b.textContent = label; b.dataset.key = key; b.onclick = fn; row.appendChild(b); };
    if (!isFront()) {
      const kinds = new Set(devices.map((d) => d.kind));
      if (kinds.has('ultra')) add('0.5×', () => switchLens('ultra'), 'ultra');
      add('1×', () => (S.lens === 'wide' ? setZoom(1) : switchLens('wide')), 'wide');
      if (S.mode === 'photo' || hwZoom) add('2×', () => { if (S.lens !== 'wide') switchLens('wide', 2); else setZoom(2); }, 'z2');
      if (kinds.has('tele')) add('望遠', () => switchLens('tele'), 'tele');
    }
    markLens();
  }
  function markLens() {
    $$('#lensRow button').forEach((b) => {
      const k = b.dataset.key;
      const on = k === 'z2' ? S.lens === 'wide' && Math.abs(zoom - 2) < 0.05
        : k === S.lens && (k !== 'wide' || Math.abs(zoom - 1) < 0.05);
      b.classList.toggle('on', on);
    });
  }
  async function switchLens(kind, z) {
    if (recorder) return;
    if (S.lens !== kind) { S.lens = kind; saveSettings(); await startCamera().catch(showError); }
    if (z) setZoom(z); else setZoom(hwZoom ? Math.max(1, caps.zoom.min) : 1);
  }

  function buildFilterStrip() {
    const st = $('#filterStrip'); st.innerHTML = '';
    for (const [id, name, css] of FILTERS) {
      const b = document.createElement('button');
      b.innerHTML = `<span class="sw" style="filter:${css}"></span>${name}`;
      b.classList.toggle('on', S.filter === id);
      b.onclick = () => { S.filter = id; saveSettings(); buildFilterStrip(); applyPreview(); updateTopbar(); };
      st.appendChild(b);
    }
  }

  // ================= 位置情報 =================
  function setLocBadge() {
    const b = $('#locBadge');
    b.className = 'badge ' + (!S.location ? 'off' : lastGeo && Date.now() - lastGeo.time < 120000 ? 'ok' : geoDenied ? 'err' : 'wait');
  }
  let geoDenied = false;
  function startGeo() {
    stopGeo();
    if (!S.location || !navigator.geolocation) { setLocBadge(); return; }
    geoWatch = navigator.geolocation.watchPosition((p) => {
      geoDenied = false;
      lastGeo = { lat: p.coords.latitude, lon: p.coords.longitude, alt: p.coords.altitude, acc: p.coords.accuracy, time: p.timestamp || Date.now() };
      setLocBadge();
    }, (e) => { if (e.code === 1) geoDenied = true; setLocBadge(); }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
    setLocBadge();
  }
  function stopGeo() { if (geoWatch != null) navigator.geolocation.clearWatch(geoWatch); geoWatch = null; }
  const currentGeo = () => (S.location && lastGeo && Date.now() - lastGeo.time < 120000 ? lastGeo : null);

  // ================= 水平器 =================
  let levelOn = false, levelAngle = 0;
  async function enableLevel() {
    try {
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        const r = await DeviceMotionEvent.requestPermission();
        if (r !== 'granted') throw new Error('denied');
      }
      if (!levelOn) addEventListener('devicemotion', onMotion);
      levelOn = true;
    } catch {
      S.level = false; saveSettings(); $('#setLevel').checked = false;
      showToast(null, '水平器にはモーションへのアクセス許可が必要です');
    }
  }
  function disableLevel() { removeEventListener('devicemotion', onMotion); levelOn = false; $('#level').hidden = true; }
  function onMotion(e) {
    const g = e.accelerationIncludingGravity; if (!g || g.x == null) return;
    const n = Math.hypot(g.x, g.y, g.z) || 9.8;
    if (Math.abs(g.z) / n > 0.85) { $('#level').hidden = true; return; } // 平置きでは非表示
    const a = Math.atan2(g.x, g.y) * 180 / Math.PI;
    let dev = ((a % 90) + 90 + 45) % 90 - 45;
    levelAngle = levelAngle * 0.7 + dev * 0.3;
    const line = $('#levelLine');
    line.style.transform = `rotate(${levelAngle}deg)`;
    line.classList.toggle('flat', Math.abs(levelAngle) < 1);
    $('#level').hidden = false;
  }

  // ================= 撮影 =================
  let canvas = null, ctx = null, P3 = false;
  function getCanvas(w, h) {
    if (!canvas) {
      canvas = document.createElement('canvas');
      try { ctx = canvas.getContext('2d', { colorSpace: 'display-p3' }); P3 = !!ctx && ctx.getContextAttributes && ctx.getContextAttributes().colorSpace === 'display-p3'; } catch { ctx = null; }
      if (!ctx) ctx = canvas.getContext('2d');
    }
    canvas.width = w; canvas.height = h;
    return ctx;
  }
  const toBlob = (c, type, q) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('画像の生成に失敗しました'))), type, q));
  async function makeThumb(src, sw, sh, mirror) {
    const s = 240 / Math.max(sw, sh);
    const c = document.createElement('canvas'); c.width = Math.round(sw * s); c.height = Math.round(sh * s);
    const x = c.getContext('2d');
    if (mirror) { x.translate(c.width, 0); x.scale(-1, 1); }
    x.drawImage(src, 0, 0, sw, sh, 0, 0, c.width, c.height);
    return toBlob(c, 'image/jpeg', 0.7);
  }

  async function capturePhoto() {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw) throw new Error('カメラの準備ができていません');
    const r = targetRatio();
    let sw = vw, sh = vh;
    if (sw / sh > r) sw = sh * r; else sh = sw / r;
    const z = hwZoom ? 1 : zoom; sw /= z; sh /= z;
    const sx = (vw - sw) / 2, sy = (vh - sh) / 2;
    const w = Math.round(sw), h = Math.round(sh);
    const c = getCanvas(w, h);
    const css = filterCss(S.filter);
    c.save();
    if (isFront() && S.mirror) { c.translate(w, 0); c.scale(-1, 1); }
    if (css && CTX_FILTER) c.filter = css;
    c.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
    c.restore();
    if (css && !CTX_FILTER) applyMatrix(c, w, h, cssToMatrix(css));
    const date = new Date();
    const thumb = await makeThumb(canvas, w, h, false);
    let blob, mime, ext;
    if (S.quality === 'png') {
      blob = await toBlob(canvas, 'image/png'); mime = 'image/png'; ext = 'png';
    } else {
      blob = await toBlob(canvas, 'image/jpeg', +S.quality); mime = 'image/jpeg'; ext = 'jpg';
      blob = await Exif.addExif(blob, { date, width: w, height: h, gps: currentGeo(), software: 'SilentCam' });
    }
    return { blob, thumb, date, mime, ext, w, h };
  }

  async function preFlash() {
    if (isFront()) { $('#screenFlash').classList.add('on'); await sleep(450); }
    else { await setTorch(true); await sleep(900); }
  }
  async function postFlash() {
    if (isFront()) $('#screenFlash').classList.remove('on');
    else await setTorch(false);
  }
  function blink() { const b = $('#blink'); b.classList.remove('go'); void b.offsetWidth; b.classList.add('go'); }

  async function countdown(sec) {
    const el = $('#countdown'); el.hidden = false;
    for (let i = sec; i > 0; i--) { el.textContent = i; await sleep(1000); }
    el.hidden = true;
  }

  async function shootOnce({ allowAutoShare }) {
    const flash = S.flash && flashAvailable();
    if (flash) await preFlash();
    let shot;
    try { shot = await capturePhoto(); } finally { if (flash) await postFlash(); }
    blink();
    const item = await storeItem('photo', shot);
    if (S.saveMode === 'each' && allowAutoShare !== null) offerSave([item], allowAutoShare);
    return item;
  }

  async function takePhoto() {
    if (busy) return; busy = true; shutter.classList.add('busy');
    try {
      if (S.timer) await countdown(S.timer);
      await shootOnce({ allowAutoShare: !S.timer });
    } catch (e) { showError(e); } finally { busy = false; shutter.classList.remove('busy'); }
  }

  // 長押しで連写
  let pressTimer = null, bursting = false, holding = false;
  async function burst() {
    if (busy) return; busy = true; bursting = true;
    const shot = []; const bc = $('#burstCount'); bc.hidden = false; bc.textContent = '0';
    try {
      while (holding && shot.length < 100) {
        shot.push(await shootOnce({ allowAutoShare: null }));
        bc.textContent = String(shot.length);
      }
    } catch (e) { showError(e); }
    finally {
      busy = false; bursting = false; setTimeout(() => { bc.hidden = true; }, 600);
      if (shot.length && S.saveMode === 'each') offerSave(shot, false);
    }
  }
  shutter.addEventListener('contextmenu', (e) => e.preventDefault());
  shutter.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (S.mode !== 'photo') return;
    holding = true;
    pressTimer = setTimeout(() => { pressTimer = null; if (holding && !S.timer) burst(); }, 400);
  });
  const release = (e) => {
    if (S.mode !== 'photo') return;
    const wasHold = !pressTimer;
    holding = false;
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    if (e.type === 'pointerup' && (!wasHold || S.timer) && !bursting) takePhoto();
  };
  shutter.addEventListener('pointerup', release);
  shutter.addEventListener('pointercancel', release);
  shutter.addEventListener('click', () => { if (S.mode === 'video') toggleRecording(); });

  // ================= 録画 =================
  // 対応端末ではHEVC(H.265)を優先し、非対応ならH.264
  const MIME_CANDIDATES = [
    'video/mp4;codecs="hvc1,mp4a.40.2"', 'video/mp4;codecs=hvc1', 'video/mp4;codecs=hev1',
    'video/mp4;codecs="avc1,mp4a.40.2"', 'video/mp4;codecs=avc1', 'video/mp4',
    'video/webm;codecs=vp9,opus', 'video/webm',
  ];
  const isHevc = (m) => /hvc1|hev1/.test(m || '');
  function supportedMimes() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return [];
    return MIME_CANDIDATES.filter((t) => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } });
  }
  const pickMime = () => supportedMimes()[0] || '';
  function codecLabel(m) {
    if (!m) return '非対応';
    if (isHevc(m)) return 'HEVC (H.265) / MP4';
    if (/avc1|mp4/.test(m)) return 'H.264 / MP4';
    return m;
  }
  function videoBitrate(hevc) {
    const k4 = S.videoRes === '4k', fps60 = +S.videoFps >= 60;
    const base = hevc ? (k4 ? 30e6 : 10e6) : (k4 ? 40e6 : 16e6); // HEVCは同等画質を低ビットレートで
    return fps60 ? base * 1.5 : base;
  }
  async function toggleRecording() {
    if (recorder) { recorder.stop(); return; }
    if (!window.MediaRecorder) { showError(new Error('このブラウザは録画に対応していません')); return; }
    if (!stream) return;
    const cands = supportedMimes(); if (!cands.length) cands.push('');
    let mime = '';
    for (const m of cands) {
      const opts = { videoBitsPerSecond: videoBitrate(isHevc(m)), audioBitsPerSecond: 160e3 };
      if (m) opts.mimeType = m;
      try { recorder = new MediaRecorder(stream, opts); mime = m; break; } catch (e) { recorder = null; }
    }
    if (!recorder) { showError(new Error('録画を開始できませんでした')); return; }
    recChunks = [];
    const vw = video.videoWidth, vh = video.videoHeight;
    const thumbP = makeThumb(video, vw, vh, isFront());
    const date = new Date();
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
    recorder.onstop = async () => {
      const type = (recorder.mimeType || mime || 'video/mp4').split(';')[0];
      const blob = new Blob(recChunks, { type }); recChunks = [];
      recorder = null; clearInterval(recTimer); $('#recTime').hidden = true;
      shutter.classList.remove('rec'); setRecordingUI(false);
      if (!blob.size) { showError(new Error('録画データが空でした')); return; }
      const item = await storeItem('video', { blob, thumb: await thumbP, date, mime: type, ext: type.includes('webm') ? 'webm' : 'mp4', w: vw, h: vh });
      if (S.saveMode === 'each') offerSave([item], true);
    };
    recorder.start(1000);
    recStart = Date.now();
    shutter.classList.add('rec'); setRecordingUI(true);
    const rt = $('#recTime'); rt.hidden = false; rt.textContent = '00:00';
    recTimer = setInterval(() => {
      const s = Math.floor((Date.now() - recStart) / 1000);
      rt.textContent = `${s >= 3600 ? Math.floor(s / 3600) + ':' : ''}${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }, 250);
  }
  function setRecordingUI(on) {
    $('#modeRow').style.visibility = on ? 'hidden' : '';
    $('#btnSwitch').style.visibility = on ? 'hidden' : '';
    $('#btnGallery').style.visibility = on ? 'hidden' : '';
    $$('#lensRow button').forEach((b) => { if (b.dataset.key !== 'z2') b.disabled = on; });
  }

  // ================= 保存・ギャラリー =================
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  function fileName(prefix, d, ext) {
    return `${prefix}_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}_${pad(d.getMilliseconds(), 3)}.${ext}`;
  }
  async function storeItem(type, shot) {
    const id = Date.now() * 100 + (idSeq++ % 100);
    const meta = {
      id, type, created: shot.date.getTime(), mime: shot.mime, saved: false,
      name: fileName(type === 'video' ? 'VID' : 'IMG', shot.date, shot.ext),
      thumb: shot.thumb, size: shot.blob.size, w: shot.w, h: shot.h,
    };
    await DB.add(meta, shot.blob);
    items.unshift(meta);
    updateGalleryButton();
    return meta;
  }
  function thumbUrl(it) {
    if (!thumbUrls.has(it.id)) thumbUrls.set(it.id, URL.createObjectURL(it.thumb));
    return thumbUrls.get(it.id);
  }
  function updateGalleryButton() {
    const img = $('#lastThumb');
    if (items[0]) img.src = thumbUrl(items[0]); else img.removeAttribute('src');
    const unsaved = items.filter((i) => !i.saved).length;
    const c = $('#galleryCount'); c.hidden = !unsaved; c.textContent = unsaved;
  }

  async function shareItems(list) {
    const files = [];
    for (const it of list) {
      const b = await DB.blob(it.id);
      if (b) files.push(new File([b], it.name, { type: it.mime, lastModified: it.created }));
    }
    if (!files.length) return false;
    if (navigator.canShare && navigator.canShare({ files })) {
      await navigator.share({ files });
    } else {
      // 共有非対応（PCなど）：ダウンロード
      for (const f of files) {
        const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
    }
    for (const it of list) { it.saved = true; await DB.put(it); }
    updateGalleryButton(); if (!$('#gallery').hidden) renderGallery();
    return true;
  }

  // 撮影直後の保存：まず共有シートを自動で開き、ブラウザに拒否されたらボタンを出す
  async function offerSave(list, tryAuto) {
    if (tryAuto) {
      try { await shareItems(list); hideToast(); return; } catch (e) { if (e && e.name === 'AbortError') { hideToast(); return; } }
    }
    showToast(list, list.length > 1 ? `${list.length}件 撮影しました` : list[0].type === 'video' ? '録画しました' : '撮影しました');
  }

  let toastList = null, toastTimer = null;
  function showToast(list, text) {
    toastList = list;
    $('#toastText').textContent = text;
    $('#toastSave').hidden = !list;
    const t = $('#toastThumb');
    if (list && list[0]) { t.src = thumbUrl(list[0]); t.hidden = false; } else t.hidden = true;
    $('#toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, list ? 10000 : 3500);
  }
  function hideToast() { $('#toast').hidden = true; toastList = null; }
  $('#toastSave').onclick = async () => {
    const l = toastList; if (!l) return;
    try { await shareItems(l); hideToast(); } catch (e) { if (e.name !== 'AbortError') showError(e); }
  };
  $('#toastClose').onclick = hideToast;

  function showError(e) {
    console.error(e);
    let msg = (e && e.message) || String(e);
    if (e && e.name === 'NotAllowedError') msg = 'カメラ（またはマイク）へのアクセスが許可されていません。設定 > Safari > カメラ を確認してください。';
    if (e && e.name === 'NotReadableError') msg = 'カメラを起動できませんでした。他のアプリがカメラを使っていないか確認してください。';
    showToast(null, msg);
  }

  // ---- ギャラリー画面 ----
  const selected = new Set(); let selecting = false;
  function renderGallery() {
    const g = $('#gGrid'); g.innerHTML = ''; g.classList.toggle('selecting', selecting);
    if (!items.length) { g.innerHTML = '<div class="empty">まだ撮影していません</div>'; }
    for (const it of items) {
      const c = document.createElement('div'); c.className = 'cell' + (selected.has(it.id) ? ' sel' : '');
      c.innerHTML = `<img src="${thumbUrl(it)}" alt=""><span class="chk"></span>${it.type === 'video' ? '<span class="tag">▶︎ ビデオ</span>' : ''}${it.saved ? '<span class="ok">✓</span>' : ''}`;
      c.onclick = () => {
        if (selecting) { selected.has(it.id) ? selected.delete(it.id) : selected.add(it.id); renderGallery(); }
        else openViewer(it);
      };
      g.appendChild(c);
    }
    $('#gSelect').textContent = selecting ? 'キャンセル' : '選択';
    $('#gAll').hidden = !selecting; $('#gSave').hidden = !selecting; $('#gDelete').hidden = !selecting;
    $('#gDeleteSaved').hidden = selecting || !items.some((i) => i.saved);
    $('#gSave').disabled = $('#gDelete').disabled = !selected.size;
    $('#gSave').textContent = selected.size ? `写真に保存 (${selected.size})` : '写真に保存';
  }
  $('#gSelect').onclick = () => { selecting = !selecting; selected.clear(); renderGallery(); };
  $('#gAll').onclick = () => { if (selected.size === items.length) selected.clear(); else items.forEach((i) => selected.add(i.id)); renderGallery(); };
  $('#gSave').onclick = async () => {
    const l = items.filter((i) => selected.has(i.id));
    try { await shareItems(l); selected.clear(); selecting = false; renderGallery(); } catch (e) { if (e.name !== 'AbortError') showError(e); }
  };
  $('#gDelete').onclick = async () => {
    const l = items.filter((i) => selected.has(i.id));
    const unsaved = l.filter((i) => !i.saved).length;
    if (!confirm(`${l.length}件を削除します。${unsaved ? `\n※ うち${unsaved}件はまだ写真アプリに保存していません。` : ''}\nこの操作は取り消せません。`)) return;
    await deleteItems(l); selected.clear(); selecting = false; renderGallery();
  };
  $('#gDeleteSaved').onclick = async () => {
    const l = items.filter((i) => i.saved);
    if (!confirm(`写真アプリに保存済みの${l.length}件をこのアプリから削除します（写真アプリ側は残ります）。`)) return;
    await deleteItems(l); renderGallery();
  };
  async function deleteItems(l) {
    for (const it of l) {
      await DB.del(it.id);
      if (thumbUrls.has(it.id)) { URL.revokeObjectURL(thumbUrls.get(it.id)); thumbUrls.delete(it.id); }
    }
    const ids = new Set(l.map((i) => i.id));
    items = items.filter((i) => !ids.has(i.id));
    updateGalleryButton();
  }

  // ---- ビューア ----
  let viewerItem = null, viewerUrl = null;
  async function openViewer(it) {
    viewerItem = it;
    const b = await DB.blob(it.id);
    if (viewerUrl) URL.revokeObjectURL(viewerUrl);
    viewerUrl = URL.createObjectURL(b);
    const body = $('#vBody'); body.innerHTML = '';
    const el = document.createElement(it.type === 'video' ? 'video' : 'img');
    el.src = viewerUrl;
    if (it.type === 'video') { el.controls = true; el.playsInline = true; }
    body.appendChild(el);
    const d = new Date(it.created);
    $('#vTitle').textContent = `${d.toLocaleString('ja-JP')}　${it.w}×${it.h}　${(it.size / 1048576).toFixed(1)}MB${it.saved ? '　✓保存済み' : ''}`;
    $('#viewer').hidden = false;
  }
  function closeViewer() {
    $('#viewer').hidden = true; $('#vBody').innerHTML = '';
    if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = null; }
  }
  $('#vSave').onclick = async () => { try { await shareItems([viewerItem]); openViewer(viewerItem); } catch (e) { if (e.name !== 'AbortError') showError(e); } };
  $('#vDelete').onclick = async () => {
    if (!confirm(`削除します。${viewerItem.saved ? '' : '\n※ まだ写真アプリに保存していません。'}\nこの操作は取り消せません。`)) return;
    await deleteItems([viewerItem]); closeViewer(); renderGallery();
  };

  // ================= 設定画面 =================
  function bindSettings() {
    const sel = { setSaveMode: 'saveMode', setQuality: 'quality', setVideoRes: 'videoRes', setVideoFps: 'videoFps' };
    for (const [id, key] of Object.entries(sel)) {
      const el = $('#' + id); el.value = S[key];
      el.onchange = () => { S[key] = el.value; saveSettings(); if ((key === 'videoRes' || key === 'videoFps') && S.mode === 'video') restartSoon(); };
    }
    const chk = { setLocation: 'location', setGrid: 'grid', setLevel: 'level', setMirror: 'mirror', setAudio: 'audio' };
    for (const [id, key] of Object.entries(chk)) {
      const el = $('#' + id); el.checked = !!S[key];
      el.onchange = () => {
        S[key] = el.checked; saveSettings();
        if (key === 'location') { if (S.location) startGeo(); else { stopGeo(); lastGeo = null; } }
        if (key === 'grid') updateTopbar();
        if (key === 'level') { if (S.level) enableLevel(); else disableLevel(); }
        if (key === 'audio' && S.mode === 'video') restartSoon();
      };
    }
  }
  function updateInfo() {
    const s = track ? track.getSettings() : {};
    const lines = [
      `カメラ: ${track ? track.label || '-' : '-'}`,
      `映像解像度: ${video.videoWidth}×${video.videoHeight}${s.frameRate ? ` / ${Math.round(s.frameRate)}fps` : ''}`,
      `ズーム: ${hwZoom ? `光学/デジタル（${caps.zoom.min}〜${caps.zoom.max}×）` : 'デジタル（切り抜き）'}`,
      `ライト: ${caps.torch ? '対応' : isFront() ? '画面フラッシュ' : '非対応'}`,
      `色空間: ${P3 ? 'Display P3' : canvas ? 'sRGB' : '撮影時に判定'}`,
      `フィルタ処理: ${CTX_FILTER ? 'GPU' : 'ソフトウェア'}`,
      `録画形式: ${codecLabel(pickMime())}`,
    ];
    $('#infoText').innerHTML = lines.map((l) => l.replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('<br>');
  }

  // ================= イベント =================
  $('#btnFlash').onclick = () => {
    S.flash = !S.flash; saveSettings(); updateTopbar();
    if (S.mode === 'video' && !isFront()) setTorch(S.flash);
  };
  $('#btnTimer').onclick = () => { S.timer = S.timer === 0 ? 3 : S.timer === 3 ? 10 : 0; saveSettings(); updateTopbar(); };
  $('#btnAspect').onclick = () => {
    const order = ['4:3', '16:9', '1:1'];
    S.aspect = order[(order.indexOf(S.aspect) + 1) % order.length]; saveSettings(); updateTopbar(); fitFinder();
  };
  $('#btnFilter').onclick = () => { const st = $('#filterStrip'); st.hidden = !st.hidden; if (!st.hidden) buildFilterStrip(); };
  $('#btnSettings').onclick = () => { updateInfo(); $('#settings').hidden = false; };
  $('#btnGallery').onclick = () => { selecting = false; selected.clear(); renderGallery(); $('#gallery').hidden = false; };
  $$('[data-close]').forEach((b) => { b.onclick = () => { const id = b.dataset.close; if (id === 'viewer') closeViewer(); else $('#' + id).hidden = true; }; });
  $('#btnSwitch').onclick = () => {
    if (recorder || busy) return;
    S.facing = S.facing === 'front' ? 'back' : 'front'; saveSettings();
    startCamera().catch(showError);
  };
  $$('#modeRow button').forEach((b) => {
    b.onclick = () => {
      if (recorder || busy || S.mode === b.dataset.mode) return;
      S.mode = b.dataset.mode; saveSettings(); updateTopbar();
      startCamera().catch(showError);
    };
  });

  // ピンチズーム
  let pinch = null;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  finder.addEventListener('touchstart', (e) => { if (e.touches.length === 2) pinch = { d: dist(e.touches), z: zoom }; }, { passive: true });
  finder.addEventListener('touchmove', (e) => { if (pinch && e.touches.length === 2) { e.preventDefault(); setZoom(pinch.z * dist(e.touches) / pinch.d); } }, { passive: false });
  finder.addEventListener('touchend', (e) => { if (e.touches.length < 2) pinch = null; });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  addEventListener('resize', () => setTimeout(fitFinder, 100));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (recorder) recorder.stop();
      stopGeo();
    } else if ($('#startScreen').hidden) {
      startGeo();
      if (!track || track.readyState === 'ended' || track.muted) restartSoon();
    }
  });

  // ================= 起動 =================
  async function boot(auto = false) {
    try {
      $('#btnStart').disabled = true;
      await startCamera();
      $('#startScreen').hidden = true;
      startGeo();
      if (S.level) {
        // iOSはモーション許可にタップ操作が必要なので、自動起動時は最初のタップで有効化
        if (auto && typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
          document.addEventListener('click', () => enableLevel(), { once: true });
        } else enableLevel();
      }
    } catch (e) {
      console.error(e);
      $('#startMsg').textContent = e && e.name === 'NotAllowedError'
        ? 'カメラへのアクセスが許可されていません。iPhoneの「設定 > アプリ > Safari > カメラ」で「確認」または「許可」にしてから、もう一度お試しください。'
        : `カメラを起動できませんでした：${(e && e.message) || e}`;
    } finally { $('#btnStart').disabled = false; }
  }
  $("#btnStart").onclick = () => boot(false);

  (async () => {
    bindSettings(); updateTopbar();
    try { items = (await DB.all()).sort((a, b) => b.id - a.id); updateGalleryButton(); } catch (e) { console.warn(e); }
    try {
      const p = navigator.permissions && await navigator.permissions.query({ name: 'camera' });
      if (p && p.state === "granted") boot(true);
    } catch {}
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  })();
})();
