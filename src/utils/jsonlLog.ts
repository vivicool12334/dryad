import * as fs from 'fs';
import * as path from 'path';

export function appendJsonlRecord<T>(
  logPath: string,
  memoryBuffer: T[],
  record: T,
  maxBuffer: number,
  onError?: (error: unknown) => void,
): void {
  memoryBuffer.push(record);
  if (memoryBuffer.length > maxBuffer) memoryBuffer.shift();

  try {
    const dir = path.dirname(logPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(record) + '\n');
  } catch (error) {
    onError?.(error);
  }
}

export function readJsonlRecords<T>(
  logPath: string,
  onError?: (error: unknown) => void,
): T[] | null {
  try {
    if (!fs.existsSync(logPath)) return [];
    const raw = fs.readFileSync(logPath, 'utf-8').trim();
    if (!raw) return [];
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch (error) {
    onError?.(error);
    return null;
  }
}
