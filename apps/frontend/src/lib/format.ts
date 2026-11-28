/** 秒 → HH:MM:SS */
export function fmtClock(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

/** kbps → "6.2 Mbps" */
export function fmtBitrate(kbps: number | null | undefined): string {
  if (kbps == null || !Number.isFinite(kbps) || kbps <= 0) return '--';
  return `${(kbps / 1000).toFixed(1)} Mbps`;
}

/** 编码名 / RTMP 编码 ID → "H.264" */
export function fmtCodec(codec: string | number | null | undefined): string {
  if (codec == null || codec === '') return '--';
  if (typeof codec === 'number') return CODEC_ID_NAMES[codec] ?? String(codec);
  const c = codec.toLowerCase().trim();
  if (c === 'h264' || c === 'avc' || c === 'avc1') return 'H.264';
  if (c === 'h265' || c === 'hevc' || c === 'hvc1') return 'H.265';
  if (c === 'aac') return 'AAC';
  if (c === 'mp3') return 'MP3';
  return codec.toUpperCase();
}

const CODEC_ID_NAMES: Record<number, string> = {
  2: 'MP3',
  7: 'H.264',
  10: 'AAC',
  12: 'H.265',
  13: 'AV1',
};

/** 往返延迟 → 网络状态文案 */
export function netLabel(rtt: number | null | undefined): string {
  if (rtt == null) return '连接中';
  if (rtt < 100) return '稳定';
  if (rtt < 300) return '一般';
  return '波动';
}

/** 两字节以内随机 id */
export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}
