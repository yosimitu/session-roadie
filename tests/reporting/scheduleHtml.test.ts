import { describe, it, expect } from 'vitest';
import { buildScheduleHtml } from '../../src/reporting/scheduleHtml.js';
import type { PersonalTime, Schedule, Session } from '../../src/api/types.js';
import type { Profile } from '../../src/profile/profileStore.js';

const GENERATED_AT = new Date('2026-10-08T05:00:00Z');

function session(sessionId: string, abbreviation: string, date: string, time: string, length: string, venue: string, extra: Partial<Session> = {}): Session {
  return { sessionId, abbreviation, title: `Title ${abbreviation}`, venue, room: `${venue} | Room 1`, sessionTime: { date, time, length }, ...extra };
}

function schedule(reserved: string[], favorites: string[] = [], personalTime: PersonalTime[] = []): Schedule {
  return { reserved, favorites, personalTime };
}

const html = (s: Schedule, sessions: Session[], options: { date?: string } = {}, profile?: Profile) =>
  buildScheduleHtml({ schedule: s, sessions, profile, generatedAt: GENERATED_AT, options });

describe('buildScheduleHtml', () => {
  const a = session('a', 'AIM101', '2026-11-30', '08:30', '60', 'MGM Grand');
  const b = session('b', 'AIM102', '2026-12-01', '10:00', '60', 'Venetian');

  it('ヘッダーに公式サイトのカタログとカレンダーへのリンクを、新しいタブで開く形で出す（日英）', () => {
    const base = { schedule: schedule([]), sessions: [a, b], generatedAt: GENERATED_AT };
    for (const [lang, label] of [['ja', 'イベントカタログ'], ['en', 'Event catalog']] as const) {
      const out = buildScheduleHtml({ ...base, lang });
      expect(out).toContain('href="https://registration.awsevents.com/flow/awsevents/reinvent2026/event-catalog/page/eventCatalog" target="_blank" rel="noopener noreferrer">' + label);
      expect(out).toContain('href="https://aws.amazon.com/jp/events/reinvent/calendar/" target="_blank" rel="noopener noreferrer"');
    }
  });

  it('account を指定したときだけ、ヘッダーにサインイン中のメールを（エスケープして）出す', () => {
    const base = { schedule: schedule([]), sessions: [a, b], generatedAt: GENERATED_AT };
    expect(buildScheduleHtml(base)).not.toContain('この予定のアカウント');

    expect(buildScheduleHtml({ ...base, account: 'me@example.com' })).toContain('この予定のアカウント: me@example.com');
    expect(buildScheduleHtml({ ...base, account: 'me@example.com', lang: 'en' })).toContain('Account for this schedule: me@example.com');
    expect(buildScheduleHtml({ ...base, account: '<b>x</b>@example.com' })).toContain('&lt;b&gt;x&lt;/b&gt;@example.com');
  });

  it('digestPeriods があるときだけ「更新履歴」タブを出し、日英で表示する', () => {
    const periods = [{ from: '2026-10-01', to: '2026-10-02', diff: { added: [b], removed: [], changed: [] } }];
    const base = { schedule: schedule([]), sessions: [a, b], generatedAt: GENERATED_AT };
    expect(buildScheduleHtml(base)).not.toContain('data-v="digest"');

    const ja = buildScheduleHtml({ ...base, digestPeriods: periods });
    expect(ja).toContain('data-v="digest"');
    expect(ja).toContain('更新履歴');
    expect(ja).toContain('id="vdigest"');
    expect(ja).toContain('Title AIM102');

    const en = buildScheduleHtml({ ...base, digestPeriods: periods, lang: 'en' });
    expect(en).toContain('Update history');
    expect(en).toContain('Removed');
  });

  it('予約済みセッションを日別に、時刻・略称・タイトル・会場つきで出力する', () => {
    const out = html(schedule(['a', 'b']), [a, b]);
    expect(out).toContain('id="day-2026-11-30"');
    expect(out).toContain('id="day-2026-12-01"');
    expect(out).toContain('08:30–09:30');
    expect(out).toContain('AIM101');
    expect(out).toContain('Title AIM101');
    expect(out).toContain('MGM Grand');
    expect(out).toContain('予約 2件');
  });

  it('カタログ由来の文字列はHTMLエスケープする', () => {
    const evil = session('x', 'EVL001', '2026-11-30', '10:00', '60', 'MGM Grand', { title: '<script>alert(1)</script> & "q"' });
    const out = html(schedule(['x']), [evil]);
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot;');
  });

  it('予約していないお気に入りを空席状況つきで別表示する（予約済みのお気に入りは重複表示しない）', () => {
    const fav = session('f', 'AIM200', '2026-11-30', '10:00', '60', 'MGM Grand', { seatAvailability: 'unavailable' });
    const out = html(schedule(['a'], ['a', 'f']), [a, fav]);
    expect(out).toContain('AIM200');
    expect(out).toContain('満席');
    expect(out).toContain('お気に入り 1件');
    // 日別と5日間通しの2つのビューに1枚ずつ（予約済みのお気に入りが、ビュー内で二重に出ない）
    expect(out.match(/data-session="a"/g)?.length).toBe(2);
    expect(out.match(/data-session="f"/g)?.length).toBe(2);
  });

  it('個人予定は、re:Roadieが書いた移動ブロックも含め、保存値を現地時刻としてそのまま描く', () => {
    const keynote: PersonalTime = {
      personalTimeId: 'k', title: 'Opening Keynote', location: 'Personal',
      description: '現地PST 12/1 08:30–10:30。アプリは保存値をそのまま表示するため、現地時刻のまま保存',
      startDateTime: '2026-12-01T08:30:00', endDateTime: '2026-12-01T10:30:00',
    };
    const travel: PersonalTime = {
      personalTimeId: 't', title: 'MGM Grand → Venetian 移動', description: '30分の移動時間を確保（概算値・要検証）',
      startDateTime: '2026-12-01T11:00:00', endDateTime: '2026-12-01T11:30:00',
    };
    const out = html(schedule([], [], [keynote, travel]), []);
    expect(out).toContain('08:30–10:30');
    expect(out).toContain('Opening Keynote');
    expect(out).toContain('11:00–11:30');
  });

  it('時間が重なる予約には「重複」、予約と個人予定の重なりには「個人予定と重複」を付ける', () => {
    const c = session('c', 'AIM103', '2026-11-30', '09:00', '60', 'MGM Grand');
    const reception: PersonalTime = {
      personalTimeId: 'r', title: 'Welcome reception', description: '現地時刻のまま保存', startDateTime: '2026-11-30T16:00:00', endDateTime: '2026-11-30T19:00:00',
    };
    const d = session('d', 'AIM104', '2026-11-30', '16:30', '60', 'MGM Grand');
    const out = html(schedule(['a', 'c', 'd'], [], [reception]), [a, c, d]);
    expect(out).toContain('重複');
    expect(out).toContain('個人予定と重複');
    expect(out).toContain('Welcome reception');
  });

  it('移動時間が足りない連続セッションに「移動不足」を付ける', () => {
    const m = session('m', 'AIM111', '2026-12-02', '10:00', '60', 'MGM Grand');
    const w = session('w', 'AIM112', '2026-12-02', '11:10', '60', 'Wynn/Encore'); // 空き10分 < 必要40分（移動30分＋到着10分）
    const out = html(schedule(['m', 'w']), [m, w]);
    expect(out).toContain('移動不足');
    expect(out).toContain('必要 40分＝移動30分＋開始10分前までの到着');
    expect(out).toContain('空き 10分');
  });

  it('プロフィールで昼休みの警告が有効なとき、昼（12:00-13:00）にかかる予約に「昼にかかる」を付ける', () => {
    const lunch = session('l', 'AIM113', '2026-12-02', '12:30', '60', 'MGM Grand');
    expect(html(schedule(['l']), [lunch], {}, { lunchBreak: true })).toContain('昼にかかる');
    expect(html(schedule(['l']), [lunch])).not.toContain('昼にかかる');
  });

  it('date を指定すると、その日だけを出力する', () => {
    const out = html(schedule(['a', 'b']), [a, b], { date: '2026-12-01' });
    expect(out).toContain('id="day-2026-12-01"');
    expect(out).not.toContain('id="day-2026-11-30"');
  });

  it('カタログに無い予約IDは、描けなかったものとして一覧に出す', () => {
    const out = html(schedule(['a', 'ghost']), [a]);
    expect(out).toContain('ghost');
    expect(out).toContain('カタログに見つからない');
  });

  it('予定が何も無ければ、その旨を表示する', () => {
    expect(html(schedule([]), [])).toContain('表示できる予定がありません');
  });

  it('外部のスクリプト・スタイルを読み込まず、時刻が会場現地（PST）であることを明記する', () => {
    const out = html(schedule(['a']), [a]);
    expect(out).not.toMatch(/<script[^>]+src=/i);
    expect(out).not.toMatch(/<link[^>]+href=["']https?:/i);
    expect(out).toContain('PST');
  });

  describe('4タブ構成とカタログの埋め込み', () => {
    const embedded = (out: string) => JSON.parse(out.split('id="ri-data">')[1].split('</script>')[0]) as {
      data: { id: string; c: string; t: string; ss: string[] }[]; ja: Record<string, string>; meta: { newBaseline: string };
    };

    it('予定・セッション一覧・全体像・メモ候補の4つのタブを持つ', () => {
      const out = html(schedule(['a']), [a]);
      for (const v of ['sched', 'list', 'ov', 'memo']) expect(out).toContain(`data-v="${v}"`);
      for (const id of ['vsched', 'vlist', 'vov', 'vmemo']) expect(out).toContain(`id="${id}"`);
    });

    it('カタログ全件（予約・お気に入りに入っていないものも）と日本語辞書を埋め込む', () => {
      const other = session('o', 'AIM900', '2026-12-04', '09:00', '60', 'Wynn/Encore');
      const out = html(schedule(['a'], ['b']), [a, b, other]);
      const data = embedded(out);
      expect(data.data.map((r) => r.id)).toEqual(['a', 'b', 'o']);
      expect(data.data.find((r) => r.id === 'a')?.ss).toContain('予約済み');
      expect(data.data.find((r) => r.id === 'b')?.ss).toContain('公式お気に入り');
      expect(data.ja['Workshop']).toBe('ワークショップ');
    });

    it('date を指定しても、一覧用のデータは全件のまま', () => {
      const out = html(schedule(['a', 'b']), [a, b], { date: '2026-12-01' });
      expect(embedded(out).data).toHaveLength(2);
    });

    it('新着のセッションIDと比較元の日付を埋め込む', () => {
      const out = buildScheduleHtml({
        schedule: schedule([]), sessions: [a, b], generatedAt: GENERATED_AT, newSessionIds: ['b'], newBaseline: '2026-10-06',
      });
      const data = embedded(out);
      expect(data.meta.newBaseline).toBe('2026-10-06');
      expect(data.data.find((r) => r.id === 'b')?.ss).toContain('新着');
    });

    it('タイトルに </script> が含まれても、scriptタグを途中で閉じない（閉じタグは2つだけ）', () => {
      const evil = session('x', 'EVL001', '2026-11-30', '10:00', '60', 'MGM Grand', { title: '</script><img src=x onerror=alert(1)>' });
      const out = html(schedule(['x']), [evil]);
      expect(out.match(/<\/script>/g)).toHaveLength(2);
      expect(embedded(out).data[0].t).toBe('</script><img src=x onerror=alert(1)>');
      expect(out).not.toContain('<img src=x onerror=alert(1)>');
    });

    it('ブラウザ側のスクリプトを埋め込み、ローカル保存のキーと翻訳APIを使う（外部へのfetchはしない）', () => {
      const out = html(schedule([]), []);
      expect(out).toContain("var LS = 'roadie26_'");
      expect(out).toContain('Translator.availability');
      expect(out).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon/);
    });
  });

  describe('5日間通しの表示と、★メモを重ねる枠', () => {
    const count = (out: string, needle: string) => out.split(needle).length - 1;
    const embeddedMeta = (out: string) => JSON.parse(out.split('id="ri-data">')[1].split('</script>')[0]).meta as {
      personal: { date: string; start: number; end: number; title: string }[]; px: number;
    };

    it('日別と5日間通しを切り替えるボタンを持ち、通しの表示は全日を横に並べる', () => {
      const out = html(schedule(['a', 'b']), [a, b]);
      expect(out).toContain('data-sv="day"');
      expect(out).toContain('data-sv="week"');
      expect(out).toContain('id="vday"');
      expect(out).toContain('id="vweek"');
      expect(out).toContain('2日間通し'); // 日数に合わせた表記（会期の5日分あれば「5日間通し」）
      expect(out).toContain('id="w-2026-11-30"');
      expect(out).toContain('id="w-2026-12-01"');
    });

    it('5日間通しの時間スケール（時刻の目盛り）は左端に1本だけ置き、日ごとの列には重ねて出さない', () => {
      const out = html(schedule(['a', 'b']), [a, b]); // 2日分
      const week = out.split('id="vweek"')[1];
      expect(week.split('class="w-axis"').length - 1).toBe(1);
      expect(week.split('<span>07:00</span>').length - 1).toBe(1); // 日の列ではなく、スケールの1本だけ
      expect(week.split('<span>12:00</span>').length - 1).toBe(1);
      // 日別の表示は、日ごとに自分のスケールを持つ（2日分）
      expect(out.split('id="vweek"')[0].split('<span>07:00</span>').length - 1).toBe(2);
      // 日の列の枠・帯・メモの入れ物は、通しでも2日分そろっている
      expect(week.split('class="t-memo"').length - 1).toBe(2);
      expect(week.split('class="t-band band-lunch"').length - 1).toBe(2);
    });

    it('予定が何も無い日でも、カタログにある日にはタイムラインの枠を出す（★メモを重ねるため）', () => {
      const out = html(schedule([]), [a, b]);
      expect(out).toContain('id="day-2026-11-30"');
      expect(out).toContain('id="day-2026-12-01"');
      expect(out).not.toContain('表示できる予定がありません');
    });

    it('各日の枠（日別・通し）に、★メモを描くための入れ物を持つ', () => {
      const out = html(schedule(['a']), [a, b]);
      expect(count(out, 'class="t-memo"')).toBe(4); // 2日 × (日別 + 通し)
      expect(out).toMatch(/class="t-grid"[^>]*data-date="2026-11-30"[^>]*data-start="420"/);
    });

    it('★メモを表示するかを切り替えるチェックボックスを持つ（既定は表示）', () => {
      expect(html(schedule([]), [a])).toMatch(/<input type="checkbox" id="showMemo" checked>/);
    });

    it('おすすめ度・理由・基準を埋め込み、一覧におすすめ順の並び替えと基準の表示欄を持つ', () => {
      // お気に入り(f)のトピックを基準に、同じトピックで予定に収まるセッション(c)をおすすめにする
      const f = session('f', 'AIM200', '2026-12-02', '10:00', '60', 'MGM Grand');
      f.topics = ['Security & Identity'];
      f.type = 'Workshop';
      const c = session('c', 'AIM201', '2026-12-03', '10:00', '60', 'MGM Grand');
      c.topics = ['Security & Identity'];
      c.type = 'Workshop';
      c.seatAvailability = 'available';
      const out = html(schedule([], ['f']), [f, c], {}, { purpose: 'learning' });
      const data = JSON.parse(out.split('id="ri-data">')[1].split('</script>')[0]) as {
        data: { id: string; rc?: number; rw?: string[]; ss: string[] }[]; meta: { recipe: { t: string; w: number; s: string }[] };
      };
      const rec = data.data.find((r) => r.id === 'c')!;
      expect(rec.rc).toBeGreaterThanOrEqual(60);
      expect(rec.rw).toEqual(expect.arrayContaining(['空席あり', '予定に収まる']));
      expect(rec.ss).toContain('おすすめ');
      expect(data.meta.recipe[0]).toEqual({ t: 'Security & Identity', w: 1, s: 'favorites' });
      expect(out).toContain('<option value="rec">おすすめ順</option>');
      expect(out).toContain('id="recipe"');
    });

    it('個人予定と重なる時間帯のセッションは、おすすめにしない（個人予定は会場現地の時刻で判定する）', () => {
      const f = session('f', 'AIM200', '2026-12-02', '10:00', '60', 'MGM Grand');
      f.topics = ['Security & Identity'];
      const during = session('d', 'AIM202', '2026-12-01', '09:00', '60', 'MGM Grand'); // 基調講演 08:30-10:30 と重なる
      during.topics = ['Security & Identity'];
      during.seatAvailability = 'available';
      const keynote: PersonalTime = {
        personalTimeId: 'k', title: 'Keynote', description: '現地時刻のまま保存',
        startDateTime: '2026-12-01T08:30:00', endDateTime: '2026-12-01T10:30:00',
      };
      const out = html(schedule([], ['f'], [keynote]), [f, during]);
      const data = JSON.parse(out.split('id="ri-data">')[1].split('</script>')[0]) as { data: { id: string; rc?: number }[] };
      expect(data.data.find((r) => r.id === 'd')?.rc).toBeUndefined();
    });

    it('予定のカード・メモ候補から一覧の詳細へ移動する処理と、メモ候補での★外しを持つ', () => {
      const out = html(schedule(['a']), [a]);
      expect(out).toContain('function jumpToSession');
      expect(out).toContain('data-jump');
      expect(out).toContain("closest('.t-card[data-session], .t-card.memo[data-id]')");
      // 予定のカード（予約・お気に入り）は、クリックできる見た目にする
      expect(out).toMatch(/\.t-card\[data-session\][^{]*\{[^}]*cursor:pointer/);
    });

    it('各日の枠に、7-8時は朝食・12-13時はランチ・18時以降は夜の帯を、予定の背後に色分けして描く', () => {
      const out = html(schedule(['a']), [a]); // 表示範囲は 07:00-21:00（開始 420 分）
      const px = (min: number) => ((min - 420) * 1.2).toFixed(1);
      expect(out).toContain(`class="t-band band-breakfast" style="top:${px(420)}px;height:72.0px"><span>朝食</span>`);
      expect(out).toContain(`class="t-band band-lunch" style="top:${px(720)}px;height:72.0px"><span>ランチ</span>`);
      expect(out).toContain(`class="t-band band-night" style="top:${px(1080)}px;height:${((1260 - 1080) * 1.2).toFixed(1)}px"><span>18時以降</span>`);
      // 日別と5日間通しの2か所 × 日数（このデータは1日）
      expect(out.split('class="t-band band-lunch"').length - 1).toBe(2);
    });

    it('表示範囲が広がっても、夜の帯は18時から表示範囲の終わりまで続く（朝食の帯は範囲外なら出さない）', () => {
      const late: PersonalTime = {
        personalTimeId: 'p', title: 'Party', description: '現地時刻のまま保存', startDateTime: '2026-11-30T19:30:00', endDateTime: '2026-11-30T23:55:00',
      };
      const out = html(schedule([], [], [late]), [a]);
      const px = (min: number) => ((min - 420) * 1.2).toFixed(1);
      expect(out).toContain(`band-night" style="top:${px(1080)}px;height:${((1440 - 1080) * 1.2).toFixed(1)}px"`);
    });

    it('帯は背後に描き、クリックを妨げない（pointer-events:none）', () => {
      const out = html(schedule(['a']), [a]);
      expect(out).toMatch(/\.t-band\{[^}]*pointer-events:none/);
      // 朝・昼・夜は、それぞれ別の色で塗り分ける（模様は使わない）
      expect(out).toContain('.band-breakfast{background:rgba(232,169,59');
      expect(out).toContain('.band-lunch{background:rgba(70,161,113');
      expect(out).toContain('.band-night{background:rgba(99,102,241');
      expect(out).not.toContain('data:image/svg+xml');
    });

    it('未予約のお気に入りの表示を切り替えるチェックボックスを持つ（既定は表示）', () => {
      expect(html(schedule([]), [a])).toMatch(/<input type="checkbox" id="showFav" checked>/);
    });

    it('未予約のお気に入りを隠したときのレイアウト（段数）を別に持ち、予約のカードが広がる', () => {
      const fav = session('f', 'AIM200', '2026-11-30', '08:30', '60', 'MGM Grand'); // aと同時刻
      const out = html(schedule(['a'], ['f']), [a, fav]);
      const card = (id: string) => out.split(`data-session="${id}"`)[1].split('>')[0];
      // 通常は2段（50%ずつ）、お気に入りを隠すと予約は100%
      expect(card('a')).toContain('width:50.00%');
      expect(card('a')).toContain('--w2:100.00%');
      expect(card('a')).toContain('--l2:0.00%');
      // お気に入り自体は、隠すと表示されないので別レイアウトは持たない
      expect(card('f')).not.toContain('--w2');
    });

    it('個人予定の時刻（会場現地の分）とタイムラインの尺度を、メモの重なり判定用に埋め込む', () => {
      const keynote: PersonalTime = {
        personalTimeId: 'k', title: 'Keynote', description: '現地時刻のまま保存',
        startDateTime: '2026-12-01T08:30:00', endDateTime: '2026-12-01T10:00:00',
      };
      const roadieBlock: PersonalTime = {
        personalTimeId: 't', title: 'A → B 移動', description: '30分の移動時間を確保（概算値・要検証）',
        startDateTime: '2026-12-01T11:00:00', endDateTime: '2026-12-01T11:30:00',
      };
      const meta = embeddedMeta(html(schedule([], [], [keynote, roadieBlock]), [a]));
      expect(meta.personal).toEqual([{ date: '2026-12-01', start: 510, end: 600, title: 'Keynote' }]); // re:Roadie の移動ブロックは含めない
      expect(meta.px).toBe(1.2);
    });

    it('date を指定したときは、通しの表示もその日だけにする', () => {
      const out = html(schedule(['a', 'b']), [a, b], { date: '2026-12-01' });
      expect(out).toContain('id="w-2026-12-01"');
      expect(out).not.toContain('id="w-2026-11-30"');
    });
  });
});

describe('buildScheduleHtml: lang', () => {
  const a = session('a', 'AIM101', '2026-11-30', '08:30', '60', 'MGM Grand', { topics: ['Security & Identity'], seatAvailability: 'available' });
  const b = session('b', 'AIM102', '2026-12-01', '10:00', '60', 'Venetian', { seatAvailability: 'unavailable' });
  const en = (s: Schedule, sessions: Session[], profile?: Profile) =>
    buildScheduleHtml({ schedule: s, sessions, profile, generatedAt: GENERATED_AT, lang: 'en' });
  // 埋め込みのJSONとスクリプトを除いた、HTML本体
  const body = (out: string) => out.replace(/<script[\s\S]*?<\/script>/g, '');

  it('省略時は日本語で、内蔵翻訳のボタンがある', () => {
    const out = html(schedule(['a']), [a]);
    expect(out).toContain('<html lang="ja">');
    expect(out).toContain('id="trBulk"');
  });

  it('en では画面の文言が英語になり、日本語は本体に残らない', () => {
    const out = en(schedule(['a', 'b']), [a, b]);
    expect(out).toContain('<html lang="en">');
    expect(out).toContain('Reserved 2 / Favorites 0');
    expect(out).toContain('Session list');
    expect(out).toContain('All 2 days');
    expect(body(out)).not.toMatch(/[\u3040-\u30ff\u4e00-\u9fff]/);
  });

  it('en では英→日の翻訳ボタンを出さず、埋め込みの文言・状態ラベルも英語になる', () => {
    const out = en(schedule(['a']), [a]);
    expect(out).not.toContain('id="trBulk"');
    const data = JSON.parse(/id="ri-data">([\s\S]*?)<\/script>/.exec(out)![1]) as { lang: string; ui: { tr: unknown }; st: { reserved: string }; ja: object; data: { ss: string[] }[] };
    expect(data.lang).toBe('en');
    expect(data.ui.tr).toBeNull();
    expect(data.st.reserved).toBe('Reserved');
    expect(data.ja).toEqual({});
    expect(data.data[0].ss).toEqual(['Reserved']);
  });

  it('en では警告・曜日・時間帯も英語になる', () => {
    const lunch: Profile = { lunchBreak: true };
    const noon = session('n', 'AIM103', '2026-11-30', '11:30', '60', 'MGM Grand');
    const out = en(schedule(['n'], ['b']), [noon, b], lunch);
    expect(out).toContain('⚠ Overlaps lunch');
    expect(out).toContain('☆ Favorite');
    expect(out).toContain('Full');
    expect(out).toContain('Mon');
    expect(out).toContain('Lunch');
  });
});
