import { evaluationCsv, evaluationRows } from './lib/evaluation-model.js';
import { pdfFiles, safePart } from './lib/pdf-model.js';
import { storedZip } from './lib/zip.js';
import { csvCell } from './lib/report-model.js';
import { showAge, oldestSuccessfulTimestamp } from './lib/time-age.js';

export async function initEvaluationReport(course, groups) {
  const countLabel = (count, singular, plural) => `${count} ${count === 1 ? singular : plural}`;
  const notifySession = error => { if (/sess[aã]o expirada|abra o (phila|moodle).*autenticad/i.test(String(error || ''))) window.dispatchEvent(new CustomEvent('phila-session-expired')); };
  const scope = document.querySelector('#evaluation-scope');
  const start = document.querySelector('#evaluation-start');
  const stop = document.querySelector('#evaluation-stop');
  const refresh = document.querySelector('#evaluation-refresh');
  const download = document.querySelector('#evaluation-export');
  const downloadPackage = document.querySelector('#evaluation-package');
  const status = document.querySelector('#evaluation-status');
  const exportableActivities = course.activities.filter(activity => ['assign', 'quiz', 'diary'].includes(activity.type));
  for (const [value, label] of [...exportableActivities.map(a => [a.activityId, a.name]), ['all', 'Curso inteiro (todas as atividades avaliáveis)']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = label; scope.append(option);
  }
  scope.style.maxWidth = '100%';
  let report, stopping = false, busy = false;
  const key = () => `evaluationExport:${course.courseId}:${scope.value}`;
  const render = () => {
    download.disabled = !report;
    downloadPackage.disabled = busy || !report || !pdfFiles(report).length;
    if (!report) { status.textContent = 'Ainda não coletado neste recorte.'; showAge(document.querySelector('#evaluation-age'), 'Notas e feedbacks — dado mais antigo', ''); return; }
    const rows = report.jobs.flatMap(j => j.rows || []);
    const pending = report.jobs.filter(j => !j.complete).length;
    const pendingDetails = rows.filter(r => r.detailUrl && !r.details).length;
    const pdfPending = report.jobs.filter(j => j.activity.type === 'assign').flatMap(j => j.rows || []).filter(r => !r.pdf || !['complete', 'absent', 'draft_excluded'].includes(r.pdf.state) || r.pdf.partial).length;
    status.textContent = `${report.jobs.length - pending}/${report.jobs.length} consultas de turma/atividade; ${countLabel(evaluationRows(report).length, 'linha exportável', 'linhas exportáveis')}. Pendências: ${countLabel(pending, 'consulta', 'consultas')}, ${countLabel(pendingDetails, 'feedback completo', 'feedbacks completos')} e ${countLabel(pdfPending, 'leitura PDF', 'leituras PDF')}. ${countLabel(pdfFiles(report).length, 'PDF disponível', 'PDFs disponíveis')} para download. ${report.finished ? 'Rodada finalizada.' : 'Coleta parcial; pode ser retomada.'}`;
    showAge(document.querySelector('#evaluation-age'), 'Notas e feedbacks — dado mais antigo', oldestSuccessfulTimestamp(report.jobs, report.collectedAt));
  };
  const save = async () => { await chrome.storage.local.set({ [key()]: report }); render(); };
  const restore = async () => {
    const requested = key();
    start.disabled = true; refresh.disabled = true; download.disabled = true; downloadPackage.disabled = true;
    const saved = await chrome.storage.local.get(requested);
    if (requested !== key()) return;
    report = saved[requested]; render(); start.disabled = false; refresh.disabled = false;
  };
  scope.addEventListener('change', restore);
  stop.onclick = () => { stopping = true; stop.disabled = true; };
  refresh.onclick = () => {
    if (busy) return;
    if (report && !confirm('Iniciar uma nova coleta? Exporte o CSV atual antes, se quiser guardar este retrato.')) return;
    return start.onclick(undefined, true);
  };
  start.onclick = async (_event, fresh = false) => {
    if (busy) return;
    start.disabled = true; refresh.disabled = true; scope.disabled = true; stop.disabled = false; stopping = false; busy = true; downloadPackage.disabled = true;
    status.classList.add('is-loading'); status.setAttribute('aria-busy', 'true');
    try {
      const response = await chrome.runtime.sendMessage({ type: 'READ_MOODLE', courseId: course.courseId });
      notifySession(response.error);
      if (response.error) throw new Error(response.error);
      if (!Array.isArray(response.groups) || groups.some(code => !response.groups.some(g => g.code === code && g.id))) throw new Error('Identificação das turmas incompleta');
      if (stopping) return;
      if (!report || fresh) {
        const activities = exportableActivities.filter(a => scope.value === 'all' || String(a.activityId) === scope.value);
        const candidate = { courseId: course.courseId, courseCode: course.moduleCode, collectedAt: new Date().toISOString(), jobs: activities.flatMap(activity => response.groups.filter(g => groups.includes(g.code)).map(group => ({ activity, group, complete: false }))) };
        // Keep the previous snapshot exportable if discovery or the initial save fails.
        await chrome.storage.local.set({ [key()]: candidate });
        report = candidate;
      }
      report.finished = false;
      await save();
      for (const job of report.jobs) {
        if (stopping) break;
        if (!job.complete || (job.activity.type === 'assign' && job.rows?.some(r => !r.pdf || r.pdf.state === 'unknown'))) {
          if (!['assign', 'quiz', 'diary'].includes(job.activity.type)) job.error = 'Tipo sem coletor de notas e feedbacks';
          else {
            status.textContent = `Lendo ${job.group.code} · ${job.activity.name}. Endpoints podem levar até 45 s por tentativa.`;
            const result = await chrome.runtime.sendMessage({ type: 'READ_MOODLE', courseId: course.courseId, activityId: job.activity.activityId, group: job.group, evaluations: true });
            notifySession(result.error);
            job.error = result.error;
            job.complete = result.complete === true;
            if (job.complete) { job.rows = result.evaluationRows; job.queriedAt = new Date().toISOString(); }
          }
          await save();
        }
        if (!job.complete) continue;
        for (const row of job.rows || []) {
          if (stopping) break;
          if (row.detailUrl && !row.details) {
            status.textContent = `Lendo feedback completo · ${job.group.code} · ${job.activity.name}. Aguarde a consulta atual.`;
            const result = await chrome.runtime.sendMessage({ type: 'READ_MOODLE', courseId: course.courseId, activityId: job.activity.activityId, group: job.group, detailUrl: row.detailUrl });
            notifySession(result.error);
            if (result.error) row.detailError = result.error;
            else { row.details = result.details; delete row.detailError; }
            await save();
          }
          if (stopping) break;
          if (row.pdf?.source && (row.pdf.state !== 'complete' || row.pdf.partial)) {
            status.textContent = `Lendo anotações publicadas · ${job.group.code} · ${job.activity.name}. Aguarde a consulta atual.`;
            const result = await chrome.runtime.sendMessage({ type: 'READ_MOODLE', courseId: course.courseId, activityId: job.activity.activityId, group: job.group, pdf: { reportKey: key(), userId: row.userId, kind: 'annotations' } });
            if (result.error) { row.pdf.error = result.error; row.pdf.state = 'pending'; }
            else { Object.assign(row.pdf, result, { state: 'complete' }); delete row.pdf.error; }
            await save();
          }
        }
      }
      report.finished = !stopping;
      await save();
    } catch (error) { status.textContent = `Coleta interrompida: ${error.message}. Dados já salvos podem ser retomados.`; }
    finally { busy = false; start.disabled = false; refresh.disabled = false; scope.disabled = false; stop.disabled = true; downloadPackage.disabled = !report || !pdfFiles(report).length; status.classList.remove('is-loading'); status.removeAttribute('aria-busy'); }
  };
  const saveDownload = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  download.onclick = () => {
    if (!report) return;
    saveDownload(new Blob([evaluationCsv(report)], { type: 'text/csv;charset=utf-8' }), `notas-feedbacks-${safePart(course.moduleCode)}-${safePart(scope.value)}.csv`);
  };
  downloadPackage.onclick = async () => {
    if (!report || busy) return;
    busy = true; stopping = false; start.disabled = true; refresh.disabled = true; scope.disabled = true; downloadPackage.disabled = true; stop.disabled = false;
    status.classList.add('is-loading'); status.setAttribute('aria-busy', 'true');
    const files = pdfFiles(report), entries = [], receipts = {}; let totalBytes = 0;
    try {
      for (const [index, file] of files.entries()) {
        if (stopping) { receipts[file.path] = 'Pendente: download interrompido'; continue; }
        if (totalBytes >= 100 * 1024 * 1024) { receipts[file.path] = 'Pendente: limite de 100 MiB do pacote'; continue; }
        status.textContent = `Baixando PDF ${index + 1}/${files.length}. Não feche esta aba. Parar produz um pacote parcial com as pendências registradas.`;
        let result;
        try {
          result = await chrome.runtime.sendMessage({ type: 'READ_MOODLE', courseId: course.courseId, activityId: file.activityId, group: { code: file.group }, pdf: { reportKey: key(), userId: file.userId, kind: 'file', url: file.url } });
        } catch { receipts[file.path] = 'Falha: conexão com a extensão interrompida'; continue; }
        if (result.error) { receipts[file.path] = `Falha: ${result.error}`; continue; }
        const bytes = Uint8Array.from(atob(result.base64), char => char.charCodeAt(0));
        if (totalBytes + bytes.length > 100 * 1024 * 1024) { receipts[file.path] = 'Pendente: limite de 100 MiB do pacote'; continue; }
        entries.push({ path: file.path, bytes }); totalBytes += bytes.length; receipts[file.path] = 'Incluído no ZIP';
      }
      const encoder = new TextEncoder();
      entries.push({ path: 'notas-feedbacks.csv', bytes: encoder.encode(evaluationCsv(report, receipts)) });
      const manifest = '\uFEFF' + [['Arquivo', 'Resultado'], ...files.map(f => [f.path, receipts[f.path] || 'Pendente'])].map(row => row.map(csvCell).join(';')).join('\r\n');
      entries.push({ path: 'arquivos.csv', bytes: encoder.encode(manifest) });
      entries.push({ path: 'LEIA-ME.txt', bytes: encoder.encode('Dados pessoais: guarde e compartilhe com cuidado.\nConsulte arquivos.csv para downloads ausentes e notas-feedbacks.csv para falhas de coleta.\nOs caminhos PDF são relativos à pasta extraída do ZIP.\nNotas se repetem por comentário; não some essas linhas.\nSomente anotações publicadas expostas pelo Moodle. Rascunhos não consultados. Sem OCR.\nA ausência de anotações na listagem não comprova ausência de rascunhos.\n') });
      saveDownload(storedZip(entries), `feedbacks-pdfs-${safePart(course.moduleCode)}-${safePart(scope.value)}.zip`);
      const included = Object.values(receipts).filter(s => s === 'Incluído no ZIP').length;
      status.textContent = `Pacote preparado: ${included}/${files.length} PDFs incluídos. ${files.length - included} pendências registradas em arquivos.csv. Confira o download no Chrome.`;
    } catch { status.textContent = 'Não foi possível preparar o pacote. A coleta permanece salva; tente novamente ou selecione uma atividade menor.'; }
    finally { busy = false; start.disabled = false; refresh.disabled = false; scope.disabled = false; stop.disabled = true; downloadPackage.disabled = !pdfFiles(report).length; status.classList.remove('is-loading'); status.removeAttribute('aria-busy'); }
  };
  await restore();
  if (!groups.length) { start.disabled = true; refresh.disabled = true; status.textContent = 'Selecione e aplique ao menos uma turma antes da coleta.'; }
}
