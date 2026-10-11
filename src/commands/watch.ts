import type { WatchEvent } from '../catalog/watch.js';

export type WatchStatus = 'empty' | 'baseline' | 'checked';

export interface WatchResult {
  status: WatchStatus;
  sessionCount: number;
  events: WatchEvent[];
}
