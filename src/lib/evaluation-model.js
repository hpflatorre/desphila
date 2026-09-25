import { csvCell } from './report-model.js';
import { pdfRows } from './pdf-model.js';

export function evaluationRows(report, receipts = {}) {
  return report.jobs.flatMap(job => {
    const base = { course: report.courseCode, courseId: report.courseId, group: job.group.code, activity: job.activity.name, activityId: job.activity.activityId, collectedAt: report.collectedAt };
    if (!job.complete) return [{ ...base, state: job.error || 'Consulta pendente', kind: 'Pendência de coleta' }];
    if (!job.rows.length) return [{ ...base, kind: 'Cobertura', state: 'Nenhuma avaliação encontrada na consulta' }];
    return job.rows.flatMap(row => {
      const { details, detailUrl, detailError, pdf, ...fields } = row;
      const evaluation = details ? details.map(detail => ({ ...base, ...fields, ...detail, state: 'Lido; avaliação disponível, sem histórico de edições' })) : [{ ...base, ...fields, state: detailUrl ? `Feedback incompleto: ${detailError || 'leitura pendente'}` : fields.state }];
      return [...evaluation, ...pdfRows(report, job, row, receipts).map(detail => ({ ...base, ...fields, feedback: '', ...detail }))];
    });
  });
}
export function evaluationCsv(report, receipts = {}) {
  const columns = { course: 'Curso', courseId: 'ID curso', group: 'Turma', userId: 'ID aluno', name: 'Aluno', activity: 'Atividade', activityId: 'ID atividade', attemptId: 'ID tentativa', entryId: 'ID registro diário', status: 'Situação', grade: 'Nota atividade', maximum: 'Máximo atividade', question: 'Questão', questionGrade: 'Nota questão (escala original)', questionMaximum: 'Máximo questão (escala original)', kind: 'Tipo de registro', feedback: 'Feedback', assessedAt: 'Data avaliação', completedAt: 'Conclusão tentativa', state: 'Cobertura / observações', collectedAt: 'Início da coleta (UTC)' };
  Object.assign(columns, { page: 'Página PDF', pdfAttempt: 'Índice tentativa PDF (inicia em 0)', annotationId: 'ID anotação', annotationType: 'Tipo marcação PDF', publication: 'Publicação PDF', x: 'Posição X', y: 'Posição Y', pdfFiles: 'Caminho PDF no pacote', pdfDownload: 'Download PDF neste pacote' });
  return '\uFEFF' + [Object.values(columns), ...evaluationRows(report, receipts).map(row => Object.keys(columns).map(key => row[key]))].map(row => row.map(csvCell).join(';')).join('\r\n');
}
