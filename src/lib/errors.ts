// Typed error envelope with stable codes for UI classification.
export type ErrorCode =
  | 'NETWORK'
  | 'PARSE'
  | 'DECRYPT'
  | 'TRANSMUX'
  | 'ASSEMBLE'
  | 'DOWNLOAD'
  | 'CANCELED'
  | 'UNKNOWN';

const HUMAN: Record<ErrorCode, string> = {
  NETWORK: 'Network error',
  PARSE: 'Playlist parse error',
  DECRYPT: 'Decryption failed',
  TRANSMUX: 'Could not transcode to MP4',
  ASSEMBLE: 'Could not assemble the file',
  DOWNLOAD: 'Browser download failed',
  CANCELED: 'Download canceled',
  UNKNOWN: 'Unknown error',
};

export class ExtensionError extends Error {
  code: ErrorCode;
  cause?: unknown;
  constructor(code: ErrorCode, message?: string, cause?: unknown) {
    super(message ?? HUMAN[code]);
    this.name = 'ExtensionError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }

  toHuman(): string {
    return this.message || HUMAN[this.code];
  }
}

export function asErrorCode(e: unknown): ErrorCode {
  if (e instanceof ExtensionError) return e.code;
  return 'UNKNOWN';
}
