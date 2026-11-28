import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Web 端构建产物目录（apps/frontend/dist）。
 * 可通过 WEB_DIST 环境变量覆盖；不存在时不托管，根路径回退到 /composite。
 */
export function webDistDir(): string {
  return process.env.WEB_DIST || join(__dirname, '..', '..', 'frontend', 'dist');
}

/** 构建产物中的 index.html，不存在返回 null */
export function webIndexFile(): string | null {
  const file = join(webDistDir(), 'index.html');
  return existsSync(file) ? file : null;
}
