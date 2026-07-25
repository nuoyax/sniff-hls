// Shared domain types for Sniffls.

/** Where a detection came from. */
export type DetectionSource = 'network' | 'dom' | 'content-type';

/** A single detected m3u8 stream on a tab. */
export interface DetectedItem {
  /** Canonical/normalized m3u8 URL. */
  url: string;
  /** Original URL as observed (before normalization). */
  originalUrl?: string;
  source: DetectionSource;
  /** Epoch ms when first detected. */
  detectedAt: number;
  /** Resolved variant info if the master playlist was probed. */
  variants?: VariantInfo[];
  /** True if this URL itself is a media playlist (has segments). */
  isMaster?: boolean;
  /** Mime type from response headers, if known. */
  contentType?: string;
  /** Page the detection happened on. */
  pageUrl?: string;
}

/** One rendition from an HLS master playlist. */
export interface VariantInfo {
  url: string;
  bandwidth: number;
  resolution?: { width: number; height: number };
  codecs?: string;
  frameRate?: number;
  /** Average bandwidth if EXT-X-STREAM-INF:AVERAGE-BANDWIDTH present. */
  averageBandwidth?: number;
  /** EXT-X-STREAM-INF:AUDIO — links to a media group of TYPE=AUDIO. */
  audioGroupId?: string;
}

/** One #EXT-X-MEDIA entry (audio/subtitles/…). */
export interface MediaRendition {
  type: 'AUDIO' | 'VIDEO' | 'SUBTITLES' | 'CLOSED-CAPTIONS' | string;
  groupId: string;
  name: string;
  /** Absolute URI of the media playlist; absent when muxed into the video playlist. */
  uri?: string;
  language?: string;
  default?: boolean;
  autoselect?: boolean;
  channels?: string;
}

/** One segment line from a media playlist. */
export interface Segment {
  /** Absolute segment URL. */
  url: string;
  /** EXTINF duration in seconds. */
  duration: number;
  /** Sequence number (from EXT-X-MEDIA-SEQUENCE, 0-based index). */
  sequence: number;
  /** Optional byte range {offset, length}. */
  byterange?: { offset: number; length: number };
  /** Optional discontinuity flag. */
  discontinuity?: boolean;
  /** Title from EXTINF if present. */
  title?: string;
}

/** Encryption info from #EXT-X-KEY. */
export interface KeyInfo {
  method: 'NONE' | 'AES-128' | 'SAMPLE-AES' | string;
  /** Absolute URI of the key, or undefined for METHOD=NONE. */
  uri?: string;
  /** IV bytes (16) parsed from IV=0x... attr, or undefined. */
  iv?: Uint8Array;
}

/** Init segment (#EXT-X-MAP). */
export interface InitSegment {
  uri: string;
  byterange?: { offset: number; length: number };
}

/** Parsed media/master playlist. */
export interface ParsedPlaylist {
  isMaster: boolean;
  version?: number;
  /** Target duration (media). */
  targetDuration?: number;
  mediaSequence?: number;
  /** true if #EXT-X-ENDLIST present (VOD, finite). */
  endList: boolean;
  variants: VariantInfo[];
  /** Master-only: TYPE → groupId → renditions (e.g. AUDIO / "audio-128000"). */
  mediaGroups?: {
    AUDIO?: Record<string, MediaRendition[]>;
    VIDEO?: Record<string, MediaRendition[]>;
    SUBTITLES?: Record<string, MediaRendition[]>;
    'CLOSED-CAPTIONS'?: Record<string, MediaRendition[]>;
  };
  segments: Segment[];
  key?: KeyInfo;
  initSegment?: InitSegment;
  /** Total duration of all segments (media, VOD). */
  totalDuration: number;
}

export type OutputFormat = 'mp4' | 'ts' | 'auto';

export type DownloadStatus =
  | 'queued'
  | 'fetching'
  | 'decrypting'
  | 'transmuxing'
  | 'assembling'
  | 'downloading' // browser native download in progress
  | 'complete'
  | 'error'
  | 'canceled';

/** A download job as the SW dispatches it to the engine host. */
export interface DownloadJob {
  id: string;
  /** m3u8 URL (master or media). */
  url: string;
  /** Page the user triggered from (for naming/context). */
  pageUrl?: string;
  /** Picked variant URL if master; equals url if media. */
  variantUrl?: string;
  /** Desired output format. */
  format: OutputFormat;
  /** Concurrency for the segment pool. */
  concurrency: number;
  /** Suggested filename without extension. */
  baseFilename: string;
  /** Full relative path for chrome.downloads (may include subfolder + ext). */
  filename?: string;
  /** Originating tab. */
  tabId?: number;
}

/** Progress event from engine → SW → UI. */
export interface DownloadProgress {
  jobId: string;
  status: DownloadStatus;
  /** Segments completed. */
  done: number;
  /** Total segments (0 if unknown). */
  total: number;
  /** Bytes fetched so far. */
  bytesLoaded: number;
  /** Estimated total bytes (0 if unknown). */
  bytesTotal: number;
  /** Final output format actually used (set when assembling). */
  outputFormat?: OutputFormat;
  /** Filename handed to chrome.downloads. */
  filename?: string;
  /** Error message if status === 'error'. */
  error?: string;
}

export interface HistoryEntry {
  id: string;
  url: string;
  pageUrl?: string;
  filename: string;
  format: OutputFormat;
  sizeBytes: number;
  startedAt: number;
  completedAt?: number;
  status: DownloadStatus;
  error?: string;
  variant?: string;
}
