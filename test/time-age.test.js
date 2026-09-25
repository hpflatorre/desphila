import test from 'node:test';
import assert from 'node:assert/strict';
import { ageText, oldestSuccessfulTimestamp } from '../src/lib/time-age.js';

const now = Date.parse('2026-09-19T15:00:00Z');
test('formata idade de coleta em minutos, horas e dias', () => {
  assert.equal(ageText('2026-09-19T15:00:00Z', now), 'agora');
  assert.equal(ageText('2026-09-19T14:43:00Z', now), 'há 17 min');
  assert.equal(ageText('2026-09-19T12:55:00Z', now), 'há 2 h 5 min');
  assert.equal(ageText('2026-09-18T12:00:00Z', now), 'há 1 dia 3 h');
  assert.equal(ageText('', now), 'nunca coletado');
});

test('idade usa o dado bem-sucedido mais antigo e ignora falhas', () => {
  const items = [
    { complete: true, queriedAt: '2026-09-19T14:00:00Z' },
    { complete: true, queriedAt: '2026-09-19T13:00:00Z' },
    { complete: false, error: 'timeout', queriedAt: '2026-09-18T10:00:00Z' },
  ];
  assert.equal(oldestSuccessfulTimestamp(items, '2026-09-19T12:00:00Z'), '2026-09-19T13:00:00Z');
  assert.equal(oldestSuccessfulTimestamp([{ complete: true }], '2026-09-19T12:00:00Z'), '2026-09-19T12:00:00Z');
  assert.equal(oldestSuccessfulTimestamp([{ complete: false }], '2026-09-19T12:00:00Z'), '');
});
