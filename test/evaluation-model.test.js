import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluationRows, evaluationCsv } from '../src/lib/evaluation-model.js';
const report = rows => ({ courseId: '18', courseCode: 'TEST', collectedAt: '2026-09-19', jobs: [{ complete: true, group: { code: 'PM1_121' }, activity: { name: 'Teste', activityId: '1' }, rows }] });
test('preserves attempts and separate full feedbacks, including zero grades', () => {
  const rows = evaluationRows(report([{ userId: '1', attemptId: '10', grade: '0', details: [{ feedback: 'A' }, { feedback: 'B' }] }, { userId: '1', attemptId: '11', grade: '' }]));
  assert.equal(rows.length, 3);
  assert.equal(rows[0].grade, '0');
  assert.equal(rows[2].grade, '');
  assert.equal(rows[2].attemptId, '11');
});
test('incomplete detail stays marked, does not silently claim full feedback', () => {
  const rows = evaluationRows(report([{ feedback: 'preview', detailUrl: 'https://example.test', detailError: 'timeout' }]));
  assert.match(rows[0].state, /incompleto.*timeout/);
  assert.equal(rows[0].detailUrl, undefined);
});
test('CSV supports multiline, quotes, accents and neutralizes spreadsheet formulas', () => {
  const csv = evaluationCsv(report([{ name: '=CMD()', feedback: 'Ação; "boa"\nLinha 2' }]));
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"\'=CMD()"'));
  assert.ok(csv.includes('"Ação; ""boa""\nLinha 2"'));
});
test('failed, pending and empty queries remain visible in export', () => {
  const data = report([]);
  data.jobs.push({ ...data.jobs[0], complete: false, error: 'Tipo sem coletor' });
  const rows = evaluationRows(data);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].kind, 'Pendência de coleta');
  assert.equal(rows[0].kind, 'Cobertura');
});
