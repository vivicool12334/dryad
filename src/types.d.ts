declare module 'busboy' {
  import { Readable } from 'stream';

  interface BusboyConfig {
    headers: Record<string, string>;
    highWaterMark?: number;
    fileHwm?: number;
    defCharset?: string;
    preservePath?: boolean;
    limits?: {
      fieldNameSize?: number;
      fieldSize?: number;
      fields?: number;
      fileSize?: number;
      files?: number;
      parts?: number;
      headerPairs?: number;
    };
  }

  interface FileInfo {
    filename: string;
    encoding: string;
    mimeType: string;
  }

  interface FieldInfo {
    nameTruncated: boolean;
    valueTruncated: boolean;
    encoding: string;
    mimeType: string;
  }

  interface Busboy extends Readable {
    on(event: 'field', listener: (name: string, value: string, info: FieldInfo) => void): this;
    on(event: 'file', listener: (name: string, stream: Readable, info: FileInfo) => void): this;
    on(event: 'finish', listener: () => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
  }

  function busboy(config: BusboyConfig): Busboy;
  export default busboy;
}
