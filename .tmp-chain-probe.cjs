// 临时排查脚本：验证 OBS -> NMS -> NestJS 代理 -> Vite 代理 这条拉流链路是否会“播放一段时间后停住”
// 生成一路仅用于传输测试的 FLV（不要求可解码），推到内置媒体服务，再经两个代理持续拉流并统计每 30s 的字节数。
const http = require('http');
const fs = require('fs');
const path = require('path');
// 用 NMS 的 WebSocket-FLV 推流，避免 HTTP POST 推流被 Node 默认 300s requestTimeout 以 408 切断
const WebSocket = require('C:/Users/admin/Desktop/fighting-plus/apps/server/node_modules/ws');

const LOG = path.join(__dirname, '.tmp-chain-probe.log');
const DURATION_MS = 400_000;
const WINDOW_MS = 30_000;
const memberId = 'probe-' + Date.now().toString(36);

const log = (obj) => {
  const line = JSON.stringify({ at: new Date().toISOString(), ...obj });
  fs.appendFileSync(LOG, line + '\n');
  console.log(line);
};

function flvTag(type, timestamp, data) {
  const buf = Buffer.alloc(11 + data.length + 4);
  buf[0] = type;
  buf.writeUIntBE(data.length, 1, 3);
  buf[4] = (timestamp >> 16) & 0xff;
  buf[5] = (timestamp >> 8) & 0xff;
  buf[6] = timestamp & 0xff;
  buf[7] = (timestamp >> 24) & 0xff;
  data.copy(buf, 11);
  buf.writeUInt32BE(11 + data.length, 11 + data.length);
  return buf;
}

function videoTag(keyframe, timestamp, payload) {
  const head = Buffer.from([keyframe ? 0x17 : 0x27, 0x01, 0, 0, 0]);
  return flvTag(9, timestamp, Buffer.concat([head, payload]));
}

const avcC = Buffer.from('0164001fffe10010016764001facd94050043ffb0110000000301000000030328f162e901000468ee3c80', 'hex');

function startPublisher(streamKey) {
  const ws = new WebSocket(`ws://127.0.0.1:8080/live/${streamKey}.flv`, 'publisher');
  ws.on('open', () => log({ ev: 'publisher-open' }));
  ws.on('error', (e) => log({ ev: 'publisher-error', msg: String(e) }));
  ws.on('close', (code, reason) => log({ ev: 'publisher-close', code, reason: String(reason) }));
  ws.on('message', (m) => log({ ev: 'publisher-message', m: String(m).slice(0, 200) }));

  let timer;
  const keyPayload = Buffer.alloc(60 * 1024, 0x41);
  const interPayload = Buffer.alloc(8 * 1024, 0x42);
  let frame = 0;
  ws.on('open', () => {
    // FLV 头（仅视频）+ PreviousTagSize0 + AVC 序列头
    ws.send(Buffer.from([0x46, 0x4c, 0x56, 0x01, 0x01, 0, 0, 0, 9, 0, 0, 0, 0]));
    ws.send(flvTag(9, 0, Buffer.concat([Buffer.from([0x17, 0x00, 0, 0, 0]), avcC])));
    timer = setInterval(() => {
      const key = frame % 60 === 0;
      ws.send(videoTag(key, Math.round((frame / 30) * 1000), key ? keyPayload : interPayload));
      frame++;
    }, 33);
  });
  return () => { clearInterval(timer); ws.close(); };
}

function startPuller(label, port, urlPath) {
  const state = { bytes: 0, lastDataAt: Date.now(), maxGapMs: 0, window: 0, status: null, ended: false, error: null };
  const req = http.get({ host: '127.0.0.1', port, path: urlPath, headers: { 'Cache-Control': 'no-store' } }, (res) => {
    state.status = res.statusCode;
    log({ ev: 'puller-headers', label, status: res.statusCode });
    res.on('data', (chunk) => {
      const now = Date.now();
      state.maxGapMs = Math.max(state.maxGapMs, now - state.lastDataAt);
      state.lastDataAt = now;
      state.bytes += chunk.length;
      state.window += chunk.length;
    });
    res.on('end', () => { state.ended = true; log({ ev: 'puller-end', label, at: Date.now() }); });
    res.on('aborted', () => { state.ended = true; log({ ev: 'puller-aborted', label }); });
    res.on('error', (e) => { state.error = String(e); log({ ev: 'puller-error', label, msg: String(e) }); });
  });
  req.on('error', (e) => { state.error = String(e); log({ ev: 'puller-error', label, msg: String(e) }); });
  return { state, req };
}

(async () => {
  fs.writeFileSync(LOG, '');
  const created = await fetch('http://127.0.0.1:3118/api/rooms', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ memberId }),
  }).then((r) => r.json());
  const { code, self, room } = created;
  const streamKey = self.streamKey;
  const playToken = room.members.find((m) => m.id === self.id).playToken;
  log({ ev: 'room', code, streamKey, playToken });

  const stopPublisher = startPublisher(streamKey);
  await new Promise((r) => setTimeout(r, 1500));
  const direct = startPuller('nest-3118', 3118, `/live/${playToken}.flv`);
  const vite = startPuller('vite-5173', 5173, `/live/${playToken}.flv`);
  const nms = startPuller('nms-8080', 8080, `/live/${streamKey}.flv`);

  const started = Date.now();
  const reporter = setInterval(() => {
    const elapsed = Date.now() - started;
    log({
      ev: 'window', t: Math.round(elapsed / 1000),
      directBytes: direct.state.window, viteBytes: vite.state.window, nmsBytes: nms.state.window,
      directTotal: direct.state.bytes, viteTotal: vite.state.bytes, nmsTotal: nms.state.bytes,
      directGapMs: Date.now() - direct.state.lastDataAt, viteGapMs: Date.now() - vite.state.lastDataAt, nmsGapMs: Date.now() - nms.state.lastDataAt,
      directMaxGapMs: direct.state.maxGapMs, viteMaxGapMs: vite.state.maxGapMs, nmsMaxGapMs: nms.state.maxGapMs,
      directEnded: direct.state.ended, viteEnded: vite.state.ended, nmsEnded: nms.state.ended,
      directError: direct.state.error, viteError: vite.state.error, nmsError: nms.state.error,
    });
    direct.state.window = 0;
    vite.state.window = 0;
    nms.state.window = 0;
  }, WINDOW_MS);

  setTimeout(async () => {
    clearInterval(reporter);
    stopPublisher();
    direct.req.destroy();
    vite.req.destroy();
    nms.req.destroy();
    await fetch(`http://127.0.0.1:3118/api/rooms/${code}/leave`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ memberId: self.id }),
    }).catch(() => {});
    log({ ev: 'done' });
  }, DURATION_MS);
})().catch((e) => log({ ev: 'fatal', msg: String(e) }));
