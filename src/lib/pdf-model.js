const collection = value => Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : null;

export function normalizePdfAnnotations(payload) {
  if (!payload || !Array.isArray(payload.pages) || !Number.isInteger(Number(payload.pagecount)) || Number(payload.pagecount) < 1 || payload.pages.length !== Number(payload.pagecount)) throw new Error('Páginas do PDF incompletas ou conversão pendente');
  const details = []; let drafts = 0;
  payload.pages.forEach((page, index) => {
    const comments = collection(page.comments), annotations = collection(page.annotations);
    if (!comments || !annotations) throw new Error('Formato das anotações não reconhecido');
    for (const [items, kind] of [[comments, 'Comentário no PDF'], [annotations, 'Marcação visual no PDF']]) {
      for (const item of items) {
        if (!item || typeof item !== 'object') throw new Error('Formato da anotação não reconhecido');
        if (![0, '0', false].includes(item.draft)) {
          if ([1, '1', true].includes(item.draft)) { drafts++; continue; }
          throw new Error('Publicação da anotação não confirmada');
        }
        if (item.pageno !== undefined && Number(item.pageno) !== index) throw new Error('Página da anotação divergente');
        if (kind === 'Comentário no PDF' && typeof item.rawtext !== 'string') throw new Error('Texto do comentário não reconhecido');
        details.push({ kind, page: index + 1, annotationId: String(item.id ?? ''), feedback: kind === 'Comentário no PDF' ? String(item.rawtext ?? '') : '', annotationType: kind === 'Comentário no PDF' ? 'comment' : String(item.type || 'unknown'), publication: 'Publicada', x: item.x ?? '', y: item.y ?? '' });
      }
    }
  });
  return { details, pages: payload.pages.length, draftsExcluded: drafts, partial: payload.partial === true || payload.partial === 1 || payload.partial === '1' };
}

export const safePart = value => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 75) || 'sem_id';
export function pdfPath(report, job, row, index) {
  const attempt = row.pdf?.source?.attemptNumber;
  return `${safePart(report.courseCode)}/${safePart(job.group.code)}/atividade-${safePart(job.activity.activityId)}/aluno-${safePart(row.userId)}-tentativa-${attempt === undefined ? 'nao_identificada' : safePart(attempt)}-${index + 1}.pdf`;
}
export function pdfFiles(report) {
  return report.jobs.filter(job => job.complete).flatMap(job => (job.rows || []).flatMap(row => (row.pdf?.files || []).map((file, index) => ({ ...file, path: pdfPath(report, job, row, index), activityId: job.activity.activityId, group: job.group.code, userId: row.userId }))));
}

export function pdfRows(report, job, row, receipts = {}) {
  if (job.activity.type !== 'assign') return [];
  const pdf = row.pdf;
  if (!pdf) return [{ kind: 'Cobertura PDF', state: 'Coleta antiga: retome para consultar PDFs; rascunhos não consultados' }];
  const paths = (pdf.files || []).map((_, i) => pdfPath(report, job, row, i));
  const shared = { pdfFiles: paths.join('\n'), pdfAttempt: pdf.source?.attemptNumber ?? '', publication: 'Rascunhos não consultados', pdfDownload: paths.length ? paths.map(path => receipts[path] || 'Não baixado neste pacote').join('\n') : 'PDF publicado não disponibilizado na listagem' };
  const status = pdf.state === 'absent' ? 'Nenhuma anotação publicada exposta na listagem; não confirma ausência de rascunhos' : pdf.error || (pdf.state === 'complete' ? 'Anotações publicadas lidas' : 'Leitura das anotações pendente');
  const rows = (pdf.details || []).map(detail => ({ ...shared, ...detail, state: pdf.partial ? 'Conversão parcial; confira o PDF' : 'Anotação publicada; confira o contexto no PDF' }));
  rows.push({ ...shared, kind: 'Cobertura PDF', state: `${status}${pdf.partial ? '; conversão parcial' : ''}${pdf.draftsExcluded ? `; ${pdf.draftsExcluded} ${pdf.draftsExcluded === 1 ? 'rascunho excluído' : 'rascunhos excluídos'}` : ''}` });
  return rows;
}
