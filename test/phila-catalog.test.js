import test from 'node:test';
import assert from 'node:assert/strict';
import { philaGroupRows } from '../src/lib/phila-catalog.js';

const MOODLE = 'https://ava.nescon.medicina.ufmg.br';

test('lê turmas de supervisão e de facilitação no mesmo formato', () => {
  const rows = philaGroupRows({
    homepageSupervisor: { gruposDeTurma: [
      { id: 1, idTurma: 10, nome: 'PMMFC003 - Turma Módulo 03 Of1 (2026/2) / PM1_121', disciplina: 'Módulo 3', linkMoodle: `${MOODLE}/cepm/course/view.php?id=20`, tutores: [] },
    ] },
    homepageTAD: { gruposDeTurmaAbertas: [
      { idGrupo: 2, idTurma: 10, nomeGrupo: 'PMMFC003 - Turma Módulo 03 Of1 (2026/2) / PM1_122', nomeDisciplina: 'Módulo 3', linkMoodle: `${MOODLE}/cepm/course/view.php?id=20` },
      // Same turma as the supervisor row: kept once, as supervisor.
      { idGrupo: 1, idTurma: 10, nomeGrupo: 'PMMFC003 - Turma Módulo 03 Of1 (2026/2) / PM1_121', nomeDisciplina: 'Módulo 3', linkMoodle: `${MOODLE}/cepm/course/view.php?id=20` },
      // Tutor training on another Moodle is not collected.
      { idGrupo: 3, idTurma: 11, nomeGrupo: 'TF_OF01 - Turma Oferta 1 (2026/2) / F1_13', nomeDisciplina: 'Oferta', linkMoodle: 'https://moodle.nescon.medicina.ufmg.br/tutor/course/view.php?id=15' },
    ] },
  }, MOODLE);
  assert.deepEqual(rows.map(row => [row.role, row.groupCode, row.moodleCourseId, row.moduleCode]), [
    ['supervisor', 'PM1_121', '20', 'PMMFC003'],
    ['facilitador', 'PM1_122', '20', 'PMMFC003'],
  ]);
  assert.equal(rows[1].groupRecordId, 2);
  assert.equal(rows[1].discipline, 'Módulo 3');
});

test('facilitador sem bloco de supervisão e conta sem nenhum papel', () => {
  const rows = philaGroupRows({ homepageSupervisor: null, homepageTAD: { gruposDeTurmaAbertas: [
    { idGrupo: 2, idTurma: 10, nomeGrupo: 'PMMFC003 - Turma / PM1_122', nomeDisciplina: 'Módulo 3', linkMoodle: `${MOODLE}/cepm/course/view.php?id=20` },
  ] } }, MOODLE);
  assert.deepEqual(rows.map(row => row.groupCode), ['PM1_122']);
  assert.throws(() => philaGroupRows({ homepageSupervisor: null, homepageTAD: null }, MOODLE), /Nenhuma turma/);
});
