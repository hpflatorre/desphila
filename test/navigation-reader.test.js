import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveStudentDestination } from '../src/lib/navigation-reader.js';

test('resolve navegação no clique usando links da linha do aluno e fallback da turma', async () => {
  const origin = 'https://ava.nescon.medicina.ufmg.br';
  const original = { fetch: globalThis.fetch, DOMParser: globalThis.DOMParser, location: globalThis.location };
  const anchor = href => ({ getAttribute: () => href });
  let requests = 0;
  let links = [];
  let entry = null;
  const row = { querySelectorAll: selector => selector.includes('/user/view.php') ? [anchor('/cepm/user/view.php?id=7')] : links.map(anchor) };
  globalThis.location = { origin };
  globalThis.fetch = async url => { requests++; return { ok: true, url: String(url), text: async () => '' }; };
  globalThis.DOMParser = class { parseFromString() { return {
    querySelector: selector => selector === 'select[name="group"]' ? { value: '42' } : null,
    querySelectorAll: selector => selector.includes('tbody tr') ? [row] : [],
    getElementById: () => entry,
  }; } };
  try {
    assert.equal(requests, 0);
    const args = { activity: { type: 'assign', activityId: '123' }, group: { id: '42', code: 'A' }, userId: '7' };
    links = ['/cepm/mod/assign/view.php?id=123&action=grader&userid=8', '/cepm/mod/assign/view.php?id=123&action=grader&userid=7'];
    let result = await resolveStudentDestination(args);
    assert.equal(result.individual, true);
    assert.equal(new URL(result.url).searchParams.get('userid'), '7');
    assert.equal(requests, 1);
    links = ['https://evil.test/cepm/mod/assign/view.php?id=123&action=grader&userid=7'];
    result = await resolveStudentDestination(args);
    assert.equal(result.individual, false);
    assert.equal(new URL(result.url).searchParams.get('action'), 'grading');
    assert.equal(new URL(result.url).searchParams.get('group'), '42');
    links = ['/cepm/mod/quiz/review.php?attempt=987'];
    result = await resolveStudentDestination({ ...args, activity: { type: 'quiz', activityId: '124' } });
    assert.equal(new URL(result.url).searchParams.get('attempt'), '987');
    entry = { id: 'entry-7' };
    result = await resolveStudentDestination({ ...args, activity: { type: 'diary', activityId: '125' } });
    assert.equal(new URL(result.url).hash, '#entry-7');
    globalThis.fetch = async () => ({ ok: true, url: origin + '/login/index.php', text: async () => '' });
    await assert.rejects(resolveStudentDestination(args), /Sessão expirada/);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
