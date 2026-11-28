// 临时：拉取 2 秒 FLV 并打印前若干 tag，检查复现流的时间戳/关键帧标志是否正确
const http = require('http');
const key = process.argv[2];
let buf = Buffer.alloc(0);
const req = http.get({ host: '127.0.0.1', port: 8080, path: `/live/${key}.flv` }, (res) => {
  res.on('data', (c) => { buf = Buffer.concat([buf, c]); });
});
setTimeout(() => {
  req.destroy();
  let p = 13;
  let n = 0;
  while (p + 11 <= buf.length && n < 14) {
    const type = buf[p];
    const size = buf.readUIntBE(p + 1, 3);
    const ts = (buf[p + 4] << 16) | (buf[p + 5] << 8) | buf[p + 6] | (buf[p + 7] << 24);
    const d = buf.subarray(p + 11, p + 11 + Math.min(size, 12));
    console.log(n, 'type', type, 'size', size, 'ts', ts, 'head', d.toString('hex'));
    p += 11 + size + 4;
    n++;
  }
  console.log('total bytes', buf.length, 'parsed to', p);
}, 2000);
