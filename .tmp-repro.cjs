// 临时复现脚本：把本机一段 OBS 录像（H.264 + AAC）循环封装成 FLV 推到内置媒体服务，
// 再用 Electron 打开调试页面，持续采样 <video> 状态，定位“播放一段时间后卡住”的原因。
// 在 Electron 主进程中 require('electron') 由内置模块解析；用普通 node 执行 dump 模式时允许缺失
let electron = {};
try { electron = require('electron'); } catch (e) { /* dump 模式下不需要 */ }
const { app, BrowserWindow } = electron;
const http = require('http');
const fs = require('fs');
const path = require('path');
// 用 NMS 的 WebSocket-FLV 推流，避免 HTTP POST 推流被 Node 默认 300s requestTimeout 以 408 切断
const WebSocket = require('C:/Users/admin/Desktop/fighting-plus/apps/server/node_modules/ws');

const MODE = process.argv[2] || 'app';
const LOG = path.join(__dirname, MODE === 'harness' ? '.tmp-harness.log' : '.tmp-repro.log');
const RUN_MS = MODE === 'harness' ? 90_000 : 420_000;
const MP4 = 'C:/Users/admin/Videos/2026-11-24 20-25-31.mp4';

const log = (obj) => {
  const line = JSON.stringify({ at: new Date().toISOString(), ...obj });
  fs.appendFileSync(LOG, line + '\n');
};

/* ---------------- MP4 -> FLV ---------------- */
function boxes(buf, start, end) {
  const out = [];
  let p = start;
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p);
    let hdr = 8;
    if (size === 1) { size = Number(buf.readBigUInt64BE(p + 8)); hdr = 16; }
    else if (size === 0) size = end - p;
    if (size < hdr) break;
    out.push({ type: buf.toString('latin1', p + 4, p + 8), start: p, size, hdr });
    p += size;
  }
  return out;
}
const find = (buf, box, type) => boxes(buf, box.start + box.hdr, box.start + box.size).find((b) => b.type === type);
/** sample entry（avc1/mp4a 等）在子 box 之前有固定字段，需要跳过 */
const entryChild = (buf, box, type, skip) => boxes(buf, box.start + box.hdr + skip, box.start + box.size).find((b) => b.type === type);
const body = (buf, box) => buf.subarray(box.start + box.hdr, box.start + box.size);

function parseTrack(buf, trak) {
  const mdia = find(buf, trak, 'mdia');
  const mdhd = find(buf, mdia, 'mdhd');
  const timescale = buf.readUInt32BE(mdhd.start + mdhd.hdr + (buf[mdhd.start + mdhd.hdr] ? 20 : 12));
  const hdlr = find(buf, mdia, 'hdlr');
  const handler = buf.toString('latin1', hdlr.start + hdlr.hdr + 8, hdlr.start + hdlr.hdr + 12);
  const stbl = find(buf, find(buf, mdia, 'minf'), 'stbl');
  const stsd = find(buf, stbl, 'stsd');
  const desc = boxes(buf, stsd.start + stsd.hdr + 8, stsd.start + stsd.size)[0];

  const stsz = find(buf, stbl, 'stsz');
  const uniform = buf.readUInt32BE(stsz.start + stsz.hdr + 4);
  const count = buf.readUInt32BE(stsz.start + stsz.hdr + 8);
  const sizes = [];
  for (let i = 0; i < count; i++) sizes.push(uniform || buf.readUInt32BE(stsz.start + stsz.hdr + 12 + 4 * i));

  const stts = find(buf, stbl, 'stts');
  const sttsN = buf.readUInt32BE(stts.start + stts.hdr + 4);
  const dts = [];
  let total = 0;
  for (let i = 0, p = stts.start + stts.hdr + 8; i < sttsN; i++, p += 8) {
    const n = buf.readUInt32BE(p);
    const d = buf.readUInt32BE(p + 4);
    for (let k = 0; k < n; k++) dts.push(total + k * d);
    total += n * d;
  }

  const ctts = find(buf, stbl, 'ctts');
  const cts = new Array(count).fill(0);
  if (ctts) {
    const n = buf.readUInt32BE(ctts.start + ctts.hdr + 4);
    let idx = 0;
    for (let i = 0, p = ctts.start + ctts.hdr + 8; i < n; i++, p += 8) {
      const c = buf.readUInt32BE(p);
      const off = buf.readInt32BE(p + 4);
      for (let k = 0; k < c && idx < count; k++, idx++) cts[idx] = off;
    }
  }

  const stsc = find(buf, stbl, 'stsc');
  const stscN = buf.readUInt32BE(stsc.start + stsc.hdr + 4);
  const stscE = [];
  for (let i = 0, p = stsc.start + stsc.hdr + 8; i < stscN; i++, p += 12) {
    stscE.push({ first: buf.readUInt32BE(p), spc: buf.readUInt32BE(p + 4) });
  }
  const stcoBox = find(buf, stbl, 'stco') || find(buf, stbl, 'co64');
  const is64 = stcoBox.type === 'co64';
  const chunkN = buf.readUInt32BE(stcoBox.start + stcoBox.hdr + 4);
  const offsets = new Array(count);
  let sample = 0;
  let si = 0;
  for (let c = 1; c <= chunkN; c++) {
    while (si + 1 < stscE.length && stscE[si + 1].first === c) si++;
    const spc = stscE[si] ? stscE[si].spc : 0;
    let off = is64 ? Number(buf.readBigUInt64BE(stcoBox.start + stcoBox.hdr + 8 + 8 * (c - 1)))
      : buf.readUInt32BE(stcoBox.start + stcoBox.hdr + 8 + 4 * (c - 1));
    for (let k = 0; k < spc && sample < count; k++, sample++) {
      offsets[sample] = off;
      off += sizes[sample];
    }
  }
  const stss = find(buf, stbl, 'stss');
  const sync = new Set();
  if (stss) {
    const n = buf.readUInt32BE(stss.start + stss.hdr + 4);
    for (let i = 0; i < n; i++) sync.add(buf.readUInt32BE(stss.start + stss.hdr + 8 + 4 * i));
  }
  return { handler, timescale, sizes, dts, cts, offsets, count, sync, totalMs: (total / timescale) * 1000, desc };
}

function audioConfig(buf, mp4a) {
  const esds = entryChild(buf, mp4a, 'esds', 28);
  const d = body(buf, esds).subarray(4);
  const readLen = (p) => { let len = 0; for (let i = 0; i < 4; i++) { const b = d[p++]; len = (len << 7) | (b & 0x7f); if (!(b & 0x80)) break; } return len; };
  let p = 0;
  const esTag = d[p++]; const esLen = readLen(p); p += 0;
  let q = p; // start of ES_Descriptor body after varlen
  const esBody = q;
  p = esBody + 3; // ES_ID(2) + flags(1)
  const flags = d[esBody + 2];
  if (flags & 0x80) p += 2;
  if (flags & 0x40) p += 2;
  // DecoderConfigDescriptor
  if (d[p++] !== 0x04) return null;
  readLen(p);
  p += 13;
  if (d[p++] !== 0x05) return null;
  const ascLen = readLen(p);
  return d.subarray(p, p + ascLen);
}

function flvTag(type, timestamp, data) {
  const ts = Math.max(0, Math.round(timestamp)) >>> 0;
  const buf = Buffer.alloc(11 + data.length + 4);
  buf[0] = type;
  buf.writeUIntBE(data.length, 1, 3);
  buf[4] = (ts >> 16) & 0xff; buf[5] = (ts >> 8) & 0xff; buf[6] = ts & 0xff; buf[7] = (ts >> 24) & 0xff;
  data.copy(buf, 11);
  buf.writeUInt32BE(11 + data.length, 11 + data.length);
  return buf;
}

function buildFlvEvents(file) {
  const top = boxes(file, 0, file.length);
  const moov = top.find((b) => b.type === 'moov');
  const traks = boxes(file, moov.start + moov.hdr, moov.start + moov.size).filter((b) => b.type === 'trak');
  const events = [];
  const tracks = [];
  let durMs = 0;
  let hasAudio = false;
  for (const trak of traks) {
    const t = parseTrack(file, trak);
    tracks.push({ handler: t.handler, count: t.count, totalMs: Math.round(t.totalMs), timescale: t.timescale });
    durMs = Math.max(durMs, t.totalMs);
    const base = t.dts[0] || 0;
    if (t.handler === 'vide') {
      const avcC = entryChild(file, t.desc, 'avcC', 78);
      events.push({ t: 0, hdr: true, buf: flvTag(9, 0, Buffer.concat([Buffer.from([0x17, 0, 0, 0, 0]), body(file, avcC)])) });
      for (let i = 0; i < t.count; i++) {
        const s = file.subarray(t.offsets[i], t.offsets[i] + t.sizes[i]);
        const key = t.sync.size ? t.sync.has(i + 1) : (s[4] & 0x1f) === 5;
        const head = Buffer.from([key ? 0x17 : 0x27, 0x01, 0, 0, 0]);
        head.writeIntBE(Math.round((t.cts[i] / t.timescale) * 1000), 2, 3);
        events.push({ t: ((t.dts[i] - base) / t.timescale) * 1000, buf: flvTag(9, (t.dts[i] - base) / t.timescale * 1000, Buffer.concat([head, s])) });
      }
    } else if (t.handler === 'soun') {
      const asc = audioConfig(file, t.desc);
      if (asc && t.count > 0) {
        hasAudio = true;
        events.push({ t: 0, hdr: true, buf: flvTag(8, 0, Buffer.concat([Buffer.from([0xaf, 0x00]), asc])) });
        for (let i = 0; i < t.count; i++) {
          const s = file.subarray(t.offsets[i], t.offsets[i] + t.sizes[i]);
          events.push({ t: ((t.dts[i] - base) / t.timescale) * 1000, buf: flvTag(8, (t.dts[i] - base) / t.timescale * 1000, Buffer.concat([Buffer.from([0xaf, 0x01]), s])) });
        }
      }
    }
  }
  events.sort((a, b) => a.t - b.t);
  return { events, durMs, tracks, hasAudio };
}

/* ---------------- FLV 发布（WebSocket-FLV 推到内置媒体服务） ---------------- */
function startPublisher(streamKey, built) {
  const headers = built.events.filter((e) => e.hdr).map((e) => e.buf);
  const events = built.events.filter((e) => !e.hdr).map((e) => ({ t: e.t, data: e.buf.subarray(11, e.buf.length - 4) }));
  const durMs = built.durMs;
  const ws = new WebSocket(`ws://127.0.0.1:8080/live/${streamKey}.flv`, 'publisher');
  ws.on('open', () => log({ ev: 'publisher-open' }));
  ws.on('error', (e) => log({ ev: 'publisher-error', msg: String(e) }));
  ws.on('close', (code, reason) => log({ ev: 'publisher-close', code, reason: String(reason) }));
  const wallStart = Date.now();
  let loop = 0;
  let idx = 0;
  let timer;
  let sent = 0;
  ws.on('open', () => {
    ws.send(Buffer.from([0x46, 0x4c, 0x56, 0x01, built.hasAudio ? 0x05 : 0x01, 0, 0, 0, 9, 0, 0, 0, 0]));
    for (const h of headers) ws.send(h);
    timer = setInterval(() => {
      const now = Date.now() - wallStart;
      // 最多超前写出 300ms 的数据
      const limit = now + 300;
      let guard = 0;
      while (guard++ < 2000) {
        if (idx >= events.length) { idx = 0; loop++; }
        const ev = events[idx];
        const t = loop * durMs + ev.t;
        if (t > limit) break;
        ws.send(flvTag(ev.data[0] === 0xaf ? 8 : 9, t, ev.data));
        idx++;
        sent++;
      }
    }, 20);
  });
  setInterval(() => log({ ev: 'publisher-sent', sent }), 60_000).unref?.();
  return () => { clearInterval(timer); ws.close(); };
}

/* ---------------- 主流程 ---------------- */
// 调试入口：node .tmp-repro.cjs dump  —— 打印素材轨道与关键帧信息
if (process.argv[2] === 'dump') {
  const f = fs.readFileSync(MP4);
  const moov = boxes(f, 0, f.length).find((b) => b.type === 'moov');
  for (const trak of boxes(f, moov.start + moov.hdr, moov.start + moov.size).filter((b) => b.type === 'trak')) {
    const t = parseTrack(f, trak);
    const nals = [];
    for (let i = 0; i < Math.min(t.count, 12); i++) {
      const s = f.subarray(t.offsets[i], t.offsets[i] + t.sizes[i]);
      nals.push(`${s[4] & 0x1f}${t.sync.has(i + 1) ? '*' : ''}`);
    }
    console.log(t.handler, 'count', t.count, 'sync', [...t.sync].slice(0, 12).join(','), 'firstNalTypes', nals.join(' '));
  }
  process.exit(0);
}
app.whenReady().then(async () => {
  fs.writeFileSync(LOG, '');
  let file;
  try {
    file = fs.readFileSync(MP4);
  } catch (e) {
    log({ ev: 'fatal', msg: 'read mp4: ' + String(e) });
    app.quit();
    return;
  }
  let built;
  try {
    built = buildFlvEvents(file);
  } catch (e) {
    log({ ev: 'fatal', msg: 'build flv: ' + String(e && e.stack || e) });
    app.quit();
    return;
  }
  log({ ev: 'flv', events: built.events.length, durMs: Math.round(built.durMs), tracks: built.tracks, hasAudio: built.hasAudio });

  const memberId = 'repro-' + Date.now().toString(36);
  const created = await fetch('http://127.0.0.1:3118/api/rooms', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ memberId }),
  }).then((r) => r.json());
  const { self, room } = created;
  const code = room.code;
  log({ ev: 'room', code, streamKey: self.streamKey });

  const stopPublisher = startPublisher(self.streamKey, built);

  const win = new BrowserWindow({
    width: 960, height: 720, x: 60, y: 60, show: true, title: 'fighting-plus 卡顿复现（临时）',
    webPreferences: { backgroundThrottling: false },
  });
  win.webContents.on('console-message', (event, level, message) => {
    const interesting = process.argv[2] === 'harness' || level >= 2 || /mpegts|Loader|SourceBuffer|MSE|IOController|Transmux|Demux|Remux/i.test(message);
    if (interesting) log({ ev: 'console', level, msg: String(message).slice(0, 300) });
  });
  win.webContents.on('render-process-gone', (_e, details) => log({ ev: 'renderer-gone', details }));
  win.webContents.session.webRequest.onCompleted((details) => {
    if (details.url.includes('/live/')) log({ ev: 'live-request-done', url: details.url, status: details.statusCode, fromCache: details.fromCache });
  });

  if (MODE === 'harness') {
    // 隔离验证：不经应用代码，直接用 mpegts.js 播放同一路流，并打开全部日志
    const flvUrl = `http://127.0.0.1:3118/live/${room.members.find((m) => m.id === self.id).playToken}.flv`;
    const mpegtsUrl = 'file:///C:/Users/admin/Desktop/fighting-plus/apps/frontend/node_modules/mpegts.js/dist/mpegts.js';
    const html = `<!doctype html><html><body style="margin:0;background:#000">
<video id="v" class="stream-video" muted autoplay playsinline style="width:100%;height:100%"></video>
<script src="${mpegtsUrl}"><\/script>
<script>
mpegts.LoggingControl.enableAll = true;
const v = document.getElementById('v');
const p = mpegts.createPlayer({ type: 'flv', isLive: true, url: ${JSON.stringify(flvUrl)}, cors: true },
  { enableWorker: false, liveBufferLatencyChasing: true, stashInitialSize: 128, lazyLoad: false });
p.on(mpegts.Events.ERROR, (t, d) => console.error('EV ERROR', JSON.stringify({ t, d })));
p.on(mpegts.Events.LOADING_COMPLETE, () => console.error('EV LOADING_COMPLETE'));
p.on(mpegts.Events.MEDIA_INFO, (i) => console.log('EV MEDIA_INFO', JSON.stringify(i)));
p.attachMediaElement(v); p.load(); v.play().catch((e) => console.error('play rejected', e));
</script></body></html>`;
    const hp = path.join(__dirname, '.tmp-harness.html');
    fs.writeFileSync(hp, html);
    await win.loadURL('file:///' + hp.replace(/\\/g, '/'));
  } else {
  await win.loadURL('http://localhost:5173/');
  await win.webContents.executeJavaScript(`
    localStorage.setItem('fighting-plus.member.v1', ${JSON.stringify(memberId)});
    localStorage.setItem('fighting-plus.session.v1', JSON.stringify({ code: ${JSON.stringify(code)}, memberId: ${JSON.stringify(self.id)}, token: ${JSON.stringify(self.token)} }));
    location.reload(); 'ok'
  `);
  await new Promise((r) => setTimeout(r, 5000));
  const entered = await win.webContents.executeJavaScript(`(() => {
    const btn = document.querySelector('.debug-btn');
    if (btn) btn.click();
    return {
      head: Boolean(document.querySelector('.app-head')),
      debugBtn: Boolean(btn),
      href: location.href,
      text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 400),
      session: localStorage.getItem('fighting-plus.session.v1'),
    };
  })()`);
  log({ ev: 'enter', ...entered });
  if (!entered.head || !entered.debugBtn) {
    log({ ev: 'enter-failed' });
    stopPublisher();
    await fetch(`http://127.0.0.1:3118/api/rooms/${code}/leave`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ memberId: self.id }),
    }).catch(() => {});
    setTimeout(() => app.quit(), 800);
    return;
  }
  }
  try {
    const png = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, '.tmp-repro.png'), png.toPNG());
  } catch (e) {
    log({ ev: 'shot-error', msg: String(e) });
  }

  const started = Date.now();
  let lastT = null;
  let lastAdvance = Date.now();
  let frozenLogged = false;
  const sampler = setInterval(async () => {
    try {
      const s = await win.webContents.executeJavaScript(`(() => {
        const v = document.querySelector('video.stream-video');
        const rows = [...document.querySelectorAll('.debug-info .debug-row.inline')].map((r) => r.textContent.replace(/\\s+/g, ' ').trim()).join(' | ');
        if (!v) return { noVideo: true, rows };
        const b = v.buffered;
        return {
          t: Math.round(v.currentTime * 1000), rs: v.readyState, paused: v.paused, w: v.videoWidth,
          ranges: b.length, start: b.length ? Math.round(b.start(0) * 1000) : null, end: b.length ? Math.round(b.end(b.length - 1) * 1000) : null,
          lag: b.length ? Math.round((b.end(b.length - 1) - v.currentTime) * 1000) : null,
          err: v.error ? v.error.code : null,
          frames: v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality().totalVideoFrames : null,
          rows,
        };
      })()`);
      const elapsed = Math.round((Date.now() - started) / 1000);
      if (s.t != null && lastT != null && Math.abs(s.t - lastT) > 300) lastAdvance = Date.now();
      lastT = s.t;
      const stallMs = Date.now() - lastAdvance;
      const every = elapsed % 15 === 0;
      if (every || (stallMs > 6000 && !frozenLogged)) {
        log({ ev: 'sample', s: elapsed, ...s, stallMs });
        if (stallMs > 6000) frozenLogged = true;
      } else if (s.t != null && stallMs < 3000) {
        frozenLogged = false;
      }
    } catch (e) {
      log({ ev: 'sample-error', msg: String(e) });
    }
  }, 1000);

  setTimeout(async () => {
    clearInterval(sampler);
    stopPublisher();
    await fetch(`http://127.0.0.1:3118/api/rooms/${code}/leave`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ memberId: self.id }),
    }).catch(() => {});
    log({ ev: 'done' });
    setTimeout(() => app.quit(), 500);
  }, RUN_MS);
});
