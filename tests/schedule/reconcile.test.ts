import { describe, it, expect } from 'vitest';
import { reconcile } from '../../src/schedule/reconcile.js';
import type { Schedule } from '../../src/api/types.js';

function schedule(overrides: Partial<Schedule> = {}): Schedule {
  return { reserved: [], favorites: [], personalTime: [], ...overrides };
}

describe('reconcile', () => {
  it('意図にあって実スケジュールに無いセッションは予約対象にする', () => {
    const plan = reconcile({ reserve: ['s1'], favorite: [] }, schedule());
    expect(plan.toReserve).toEqual(['s1']);
    expect(plan.toCancelReservation).toEqual([]);
  });

  it('実スケジュールにあって意図に無いセッションはキャンセル対象にする', () => {
    const plan = reconcile({ reserve: [], favorite: [] }, schedule({ reserved: ['s1'] }));
    expect(plan.toCancelReservation).toEqual(['s1']);
    expect(plan.toReserve).toEqual([]);
  });

  it('お気に入りも同様に差分を取る', () => {
    const plan = reconcile(
      { reserve: [], favorite: ['s1', 's2'] },
      schedule({ favorites: ['s2', 's3'] }),
    );
    expect(plan.toFavorite).toEqual(['s1']);
    expect(plan.toUnfavorite).toEqual(['s3']);
  });

  it('一致していれば何もしない（収束済み）', () => {
    const plan = reconcile(
      { reserve: ['s1'], favorite: ['s2'] },
      schedule({ reserved: ['s1'], favorites: ['s2'] }),
    );
    expect(plan.toReserve).toEqual([]);
    expect(plan.toCancelReservation).toEqual([]);
    expect(plan.toFavorite).toEqual([]);
    expect(plan.toUnfavorite).toEqual([]);
  });

  it('favoriteを省略すると、お気に入りは現状維持（解除しない）', () => {
    const plan = reconcile({ reserve: ['s1'] }, schedule({ favorites: ['f1', 'f2'] }));
    expect(plan.toReserve).toEqual(['s1']);
    expect(plan.toFavorite).toEqual([]);
    expect(plan.toUnfavorite).toEqual([]);
  });

  it('reserveを省略すると、予約は現状維持（取り消さない）', () => {
    const plan = reconcile({ favorite: [] }, schedule({ reserved: ['s1'], favorites: ['f1'] }));
    expect(plan.toCancelReservation).toEqual([]);
    expect(plan.toUnfavorite).toEqual(['f1']);
  });

  it('同じ入力なら常に同じ結果を返す（冪等性）', () => {
    const desired = { reserve: ['s1', 's2'], favorite: ['s3'] };
    const actual = schedule({ reserved: ['s2'], favorites: [] });
    const plan1 = reconcile(desired, actual);
    const plan2 = reconcile(desired, actual);
    expect(plan1).toEqual(plan2);
  });
});
