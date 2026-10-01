import { describe, it, expect } from 'vitest';
import type { BulkFailureCode, SeatAvailability } from '../../src/api/types.js';

describe('api/types', () => {
  it('BulkFailureCode に scheduleConflict が含まれる（型レベルの回帰確認用の値リスト）', () => {
    const codes: BulkFailureCode[] = [
      'sessionNotReservable', 'scheduleConflict', 'alreadyScheduled',
      'sessionFull', 'insufficientAccess', 'timePassed',
      'alreadyFavorited', 'notFavorited', 'other',
    ];
    expect(codes).toHaveLength(9);
  });

  it('SeatAvailability は件数ではなくバンド', () => {
    const bands: SeatAvailability[] = ['available', 'limited', 'veryLimited', 'unavailable', 'walkUp'];
    expect(bands).toContain('walkUp');
  });
});
