import { describe, it, expect, vi } from 'vitest';
import { createPersonalTime, deletePersonalTime, resolvePersonalTimeId } from '../../src/schedule/personalTime.js';
import type { ApiClient } from '../../src/api/client.js';
import type { PersonalTimeInput, Schedule } from '../../src/api/types.js';

describe('createPersonalTime', () => {
  it('PersonalTimeInputをそのままPOSTする（成功レスポンスにIDは含まれない）', async () => {
    const postJson = vi.fn().mockResolvedValue({ content: '' });
    const client = { postJson } as unknown as ApiClient;
    const input: PersonalTimeInput = {
      startDateTime: '2026-12-02T19:00:00',
      endDateTime: '2026-12-02T19:30:00',
      title: 'Venetian 〕 Wynn 移動',
      description: '20分の移動時間を確保',
    };

    await createPersonalTime(client, 'reinvent2026', input);

    expect(postJson).toHaveBeenCalledWith('/v1/events/reinvent2026/schedule/personal-time', input, 'CreatePersonalTime');
  });
});

describe('deletePersonalTime', () => {
  it('404は既に削除済みとして扱う（二重送信時の冪等性）', async () => {
    const deleteExpectNotFoundOk = vi.fn().mockResolvedValue('alreadyGone');
    const client = { deleteExpectNotFoundOk } as unknown as ApiClient;

    const status = await deletePersonalTime(client, 'reinvent2026', 'pt-1');

    expect(status).toBe('alreadyGone');
    expect(deleteExpectNotFoundOk).toHaveBeenCalledWith('/v1/events/reinvent2026/schedule/personal-time/pt-1', 'DeletePersonalTime');
  });
});

describe('resolvePersonalTimeId', () => {
  it('startDateTimeとtitleが一致するエントリのIDを返す（2026-09-28実データ: 作成直後のGetScheduleで解決する前提）', () => {
    const schedule: Schedule = {
      reserved: [], favorites: [],
      personalTime: [
        { personalTimeId: 'pt-1', startDateTime: '2026-12-02T19:00:00', endDateTime: '2026-12-02T19:30:00', title: 'A移動', description: '' },
        { personalTimeId: 'pt-2', startDateTime: '2026-12-02T20:00:00', endDateTime: '2026-12-02T20:30:00', title: 'B移動', description: '' },
      ],
    };
    const input: PersonalTimeInput = {
      startDateTime: '2026-12-02T20:00:00', endDateTime: '2026-12-02T20:30:00', title: 'B移動', description: '',
    };

    expect(resolvePersonalTimeId(schedule, input)).toBe('pt-2');
  });

  it('一致するエントリが無ければundefinedを返す', () => {
    const schedule: Schedule = { reserved: [], favorites: [], personalTime: [] };
    const input: PersonalTimeInput = { startDateTime: '2026-12-02T20:00:00', endDateTime: '2026-12-02T20:30:00', title: 'X', description: '' };

    expect(resolvePersonalTimeId(schedule, input)).toBeUndefined();
  });
});
