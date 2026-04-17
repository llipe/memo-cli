export function debugLog(message: string): void {
  if (process.env['MEMO_DEBUG'] === 'true') {
    process.stderr.write(`[debug] ${message}\n`);
  }
}
