import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePdfAnnotations, pdfFiles, pdfRows } from '../src/lib/pdf-model.js';
import { evaluationCsv } from '../src/lib/evaluation-model.js';
const sample = () => ({ pagecount: 2, partial: false, pages: [{ comments: { 7: { id: 7, rawtext: '=A1\nComentário "sintético"', draft: '0', pageno: 0, x: 0, y: 30 }, 8: { id: 8, rawtext: 'RASCUNHO PRIVADO', draft: 1 } }, annotations: [] }, { comments: [], annotations: [{ id: 9, draft: 0, type: 'highlight', pageno: 1 }] }] });
test('PDF preserves pages and visual marks; excludes draft text', () => {
  const r = normalizePdfAnnotations(sample());
  assert.equal(r.details.length, 2); assert.equal(r.details[0].page, 1); assert.equal(r.details[1].page, 2);
  assert.equal(r.details[0].x, 0); assert.equal(r.details[1].feedback, ''); assert.equal(r.draftsExcluded, 1);
  assert.ok(!JSON.stringify(r).includes('RASCUNHO PRIVADO'));
});
test('PDF fails closed on unknown publication, incomplete pages and malformed schema', () => {
  assert.throws(() => normalizePdfAnnotations({ pagecount: 0, pages: [] }), /incompletas/);
  const p = sample(); p.pages[0].comments[7].draft = undefined;
  assert.throws(() => normalizePdfAnnotations(p), /Publicação/);
  assert.throws(() => normalizePdfAnnotations({ ...sample(), pagecount: 3 }), /incompletas/);
  const q = sample(); q.pages[1].annotations[0].pageno = 5;
  assert.throws(() => normalizePdfAnnotations(q), /divergente/);
  assert.throws(() => normalizePdfAnnotations({ pagecount: 1, pages: [{}] }), /Formato/);
});
const report = () => ({ courseId: '13', courseCode: 'PMMFC001', jobs: [{ complete: true, group: { code: 'PM1_121' }, activity: { type: 'assign', activityId: '819', name: 'Sintético' }, rows: [{ userId: '10', name: 'Exemplo', grade: '0', pdf: { state: 'complete', source: { attemptNumber: 0 }, files: [{ url: 'https://example.invalid/private' }], ...normalizePdfAnnotations(sample()) } }] }] });
test('PDF filenames are unique, sanitized and linked to CSV download receipts', () => {
  const r = report(), files = pdfFiles(r);
  assert.match(files[0].path, /PMMFC001\/PM1_121\/atividade-819\/aluno-10-tentativa-0-1.pdf$/);
  const csv = evaluationCsv(r, { [files[0].path]: 'Incluído no ZIP' });
  assert.ok(csv.includes('Incluído no ZIP')); assert.ok(csv.includes(files[0].path));
  assert.ok(!csv.includes('example.invalid')); assert.ok(!csv.includes('RASCUNHO PRIVADO')); assert.ok(csv.includes("'=A1"));
  r.jobs[0].rows[0].userId = '../../escape';
  assert.ok(!pdfFiles(r)[0].path.includes('..'));
});
test('empty, unknown, partial and legacy PDF states cannot imply full coverage', () => {
  const r = report(), j = r.jobs[0], row = j.rows[0];
  delete row.pdf;
  assert.match(pdfRows(r, j, row)[0].state, /Coleta antiga/);
  row.pdf = { state: 'absent', files: [] };
  assert.match(pdfRows(r, j, row)[0].state, /não confirma ausência de rascunhos/);
  row.pdf = { state: 'pending', files: [], error: 'Timeout' };
  assert.match(pdfRows(r, j, row)[0].state, /Timeout/);
  row.pdf = { ...normalizePdfAnnotations(sample()), state: 'complete', partial: true, files: [] };
  assert.ok(pdfRows(r, j, row).every(x => /parcial/.test(x.state)));
});
