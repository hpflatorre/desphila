import { groupMatrix, stateForActivity, STATUS_LABELS, csvCell, attendanceForStudent, pendingAnalysis, normalizeWhatsAppPhone, buildPendingMessage, buildWhatsAppUrl, rnpAttentionAnalysis, unusedActivities, activityCompletion, feedbackPendingAnalysis, pendingExportRows, waitingDaysLabel } from './lib/report-model.js';
import { showAge, oldestSuccessfulTimestamp } from './lib/time-age.js';

let currentCourse;
let currentGroups;
let running = false;
let stopRequested = false;
let report;
let rnpReport;
let selectedActivities = new Set();
let feedbackRequiredActivities = new Set();
let whatsappContacts = {};
let showOnlyPending = true;
let rnpAttentionPercent = 50;
let includeRnpAttention = true;
const node = (tag, value) => { const e = document.createElement(tag); e.textContent = value; return e; };
const countLabel = (count, singular, plural) => `${count} ${count === 1 ? singular : plural}`;
// A session error stops the caller; `retry` runs again once the report regains the Moodle login.
const send = async (message, retry) => {
  const result = await chrome.runtime.sendMessage(message);
  if (!result) throw new Error('O coletor não retornou resultado');
  if (result.error && /sess[aã]o expirada|abra o (phila|moodle).*autenticad/i.test(result.error)) {
    window.dispatchEvent(new CustomEvent('moodle-session-expired', { detail: { retry } }));
    throw new Error(result.error);
  }
  return result;
};
const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
};
async function copyToClipboard(value) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(String(value));
      return true;
    }
  } catch { /* Use the editable fallback below when clipboard permission is unavailable. */ }
  const textarea = document.createElement('textarea');
  textarea.value = String(value); textarea.style.position = 'fixed'; textarea.style.opacity = '0';
  document.body.append(textarea); textarea.focus(); textarea.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch { copied = false; }
  textarea.remove();
  return copied;
}
const safeFilename = value => String(value || 'relatorio').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
function messageImage(message, title) {
  const canvas = document.createElement('canvas'); const context = canvas.getContext('2d');
  const width = 1200, padding = 56, lineHeight = 30, maxTextWidth = width - padding * 2;
  context.font = '22px system-ui, sans-serif';
  const lines = [];
  for (const paragraph of String(message).split('\n')) {
    if (!paragraph) { lines.push(''); continue; }
    const words = paragraph.split(/\s+/); let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width > maxTextWidth && line) { lines.push(line); line = word; } else line = candidate;
    }
    lines.push(line);
  }
  canvas.width = width; canvas.height = Math.max(320, padding * 2 + 60 + lines.length * lineHeight);
  context.fillStyle = '#f5faf7'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#145c43'; context.font = 'bold 30px system-ui, sans-serif'; context.fillText(title, padding, padding);
  context.fillStyle = '#173b30'; context.font = '22px system-ui, sans-serif';
  lines.forEach((line, index) => context.fillText(line, padding, padding + 60 + index * lineHeight));
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}
export async function initMoodleReport(course, groups) {
  currentCourse = course;
  currentGroups = groups;
  const selectionKey = `moodlePendingSelection:${course.courseId}`;
  const pendingOnlyKey = `moodlePendingOnly:${course.courseId}`;
  const attentionKey = `moodleRnpParticipationCutoffPercent:${course.courseId}`;
  const attentionEnabledKey = `moodleRnpAttentionEnabled:${course.courseId}`;
  const feedbackRequiredKey = `moodleFeedbackRequired:${course.courseId}`;
  const saved = await chrome.storage.local.get([`moodleReport:${course.courseId}`, selectionKey, feedbackRequiredKey, pendingOnlyKey, attentionKey, attentionEnabledKey, 'moodleWhatsAppContacts']);
  report = saved[`moodleReport:${course.courseId}`];
  selectedActivities = new Set((saved[selectionKey] || []).map(String));
  feedbackRequiredActivities = new Set((saved[feedbackRequiredKey] || []).map(String));
  whatsappContacts = saved.moodleWhatsAppContacts || {};
  showOnlyPending = saved[pendingOnlyKey] !== false;
  rnpAttentionPercent = Number.isFinite(Number(saved[attentionKey])) ? Math.min(100, Math.max(0, Number(saved[attentionKey]))) : 50;
  includeRnpAttention = saved[attentionEnabledKey] !== false;
  const rnp = await chrome.storage.local.get('rnpReport');
  rnpReport = String(rnp.rnpReport?.courseId) === String(course.courseId) ? rnp.rnpReport : null;
  if (report) render();
}
export async function refreshMoodleRnpReport() {
  const saved = await chrome.runtime.sendMessage({ type: 'GET_RNP_REPORT' });
  rnpReport = String(saved.report?.courseId) === String(currentCourse?.courseId) ? saved.report : null;
  if (report) render();
  return rnpReport;
}
const allSupportedActivities = () => currentCourse.activities.filter(a => ['assign','quiz','diary','wiki'].includes(a.type));
const inferredUnusedActivities = () => unusedActivities(report, allSupportedActivities(), currentGroups);
const supportedActivities = () => {
  const omitted = new Set(inferredUnusedActivities().map(activity => String(activity.activityId)));
  return allSupportedActivities().filter(activity => !omitted.has(String(activity.activityId)));
};
const selectedForAnalysis = () => supportedActivities().filter(a => selectedActivities.has(String(a.activityId)));
const formatUpdatedAt = () => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(report.updatedAt || report.collectedAt));
async function saveSelection() {
  await chrome.storage.local.set({
    [`moodlePendingSelection:${currentCourse.courseId}`]: [...selectedActivities],
    [`moodleFeedbackRequired:${currentCourse.courseId}`]: [...feedbackRequiredActivities],
  });
}
async function saveContact(code, contact) {
  whatsappContacts = { ...whatsappContacts, [code]: contact };
  await chrome.storage.local.set({ moodleWhatsAppContacts: whatsappContacts });
}
function statusLink(label, activity, groupCode, userId) {
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'status-anchor'; link.textContent = label;
  link.title = `Localizar avaliação de ${activity.name} no Moodle`;
  link.addEventListener('click', async () => {
    link.disabled = true; link.setAttribute('aria-busy', 'true'); link.textContent = 'Localizando avaliação…';
    let notice = link.parentElement.querySelector('.navigation-notice');
    if (!notice) { notice = node('span', ''); notice.className = 'navigation-notice'; notice.setAttribute('role', 'status'); link.after(notice); }
    notice.textContent = '';
    try {
      const result = await send({ type: 'OPEN_STUDENT_ACTIVITY', courseId: currentCourse.courseId, activityId: activity.activityId, groupCode, userId }, () => link.click());
      if (result.error) throw new Error(result.error);
      notice.textContent = result.individual ? '' : activity.type === 'wiki' ? ' Aberto o histórico de edições da wiki da turma.' : ' Avaliação individual não localizada; aberta a listagem da turma.';
    } catch (error) { notice.textContent = ` ${error.message}`; }
    finally { link.disabled = false; link.removeAttribute('aria-busy'); link.textContent = label; }
  });
  return link;
}
function render() {
  const output = document.querySelector('#moodle-results');
  const openGroups = new Set([...output.querySelectorAll('details[open][data-group]')].map(item => item.dataset.group));
  output.replaceChildren();
  const activities = supportedActivities();
  const selector = document.createElement('fieldset'); selector.className = 'pending-selector';
  const legend = node('legend', 'Atividades consideradas na análise de pendências'); selector.append(legend);
  const selectedActivityCount = activities.filter(activity => selectedActivities.has(String(activity.activityId))).length;
  const help = node('p', selectedActivityCount ? `${selectedActivityCount} ${selectedActivityCount === 1 ? 'atividade selecionada' : 'atividades selecionadas'}. Apenas estados explicitamente pendentes serão destacados.` : 'Selecione uma ou mais atividades que já deveriam ter sido entregues.');
  help.className = 'pending-help'; selector.append(help);
  const choices = document.createElement('div'); choices.className = 'pending-choices';
  for (const activity of activities) {
    const activityChoice = document.createElement('div'); activityChoice.className = 'activity-analysis-choice';
    activityChoice.append(node('strong', activity.name));
    const label = document.createElement('label');
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = selectedActivities.has(String(activity.activityId));
    checkbox.addEventListener('change', async () => {
      if (checkbox.checked) selectedActivities.add(String(activity.activityId)); else selectedActivities.delete(String(activity.activityId));
      await saveSelection(); render();
    });
    label.append(checkbox, document.createTextNode('Verificar entrega'));
    const feedbackLabel = document.createElement('label');
    const feedbackCheckbox = document.createElement('input'); feedbackCheckbox.type = 'checkbox'; feedbackCheckbox.checked = feedbackRequiredActivities.has(String(activity.activityId));
    feedbackCheckbox.addEventListener('change', async () => {
      if (feedbackCheckbox.checked) feedbackRequiredActivities.add(String(activity.activityId)); else feedbackRequiredActivities.delete(String(activity.activityId));
      await saveSelection(); render();
    });
    feedbackLabel.append(feedbackCheckbox, document.createTextNode('Verificar feedback'));
    // Wikis have no grades or feedback in Moodle.
    activityChoice.append(label, ...(activity.type === 'wiki' ? [] : [feedbackLabel])); choices.append(activityChoice);
  }
  selector.append(choices);
  const filterLabel = document.createElement('label'); filterLabel.className = 'pending-only-toggle';
  const filter = document.createElement('input'); filter.type = 'checkbox'; filter.checked = showOnlyPending;
  filter.addEventListener('change', async () => {
    showOnlyPending = filter.checked;
    await chrome.storage.local.set({ [`moodlePendingOnly:${currentCourse.courseId}`]: showOnlyPending });
    render();
  });
  filterLabel.append(filter, document.createTextNode('Mostrar nas listagens somente alunos com pendências ou pontos de atenção'));
  selector.append(filterLabel);
  const attentionToggleLabel = document.createElement('label'); attentionToggleLabel.className = 'rnp-attention-toggle';
  const attentionToggle = document.createElement('input'); attentionToggle.type = 'checkbox'; attentionToggle.checked = includeRnpAttention;
  attentionToggle.addEventListener('change', async () => {
    includeRnpAttention = attentionToggle.checked;
    await chrome.storage.local.set({ [`moodleRnpAttentionEnabled:${currentCourse.courseId}`]: includeRnpAttention });
    render();
  });
  attentionToggleLabel.append(attentionToggle, document.createTextNode('Incluir presenças curtas na análise, no filtro e na mensagem do WhatsApp'));
  selector.append(attentionToggleLabel);
  const thresholdLabel = document.createElement('label'); thresholdLabel.className = 'rnp-threshold';
  thresholdLabel.append(document.createTextNode('Sinalizar participação RNP abaixo de '));
  const threshold = document.createElement('input'); threshold.type = 'number'; threshold.min = '0'; threshold.max = '100'; threshold.step = '5'; threshold.value = String(rnpAttentionPercent); threshold.setAttribute('aria-label', 'Limiar percentual de participação RNP');
  threshold.disabled = !includeRnpAttention;
  thresholdLabel.append(threshold, document.createTextNode('% da duração das sessões das quais o aluno participou.'));
  selector.append(thresholdLabel);
  threshold.addEventListener('change', async () => {
    rnpAttentionPercent = Math.min(100, Math.max(0, Number(threshold.value) || 0));
    await chrome.storage.local.set({ [`moodleRnpParticipationCutoffPercent:${currentCourse.courseId}`]: rnpAttentionPercent });
    render();
  });
  const selectionActions = document.createElement('div'); selectionActions.className = 'compact-actions';
  for (const [label, all] of [['Selecionar todas', true], ['Limpar seleção', false]]) {
    const button = node('button', label); button.type = 'button'; button.className = 'secondary';
    button.addEventListener('click', async () => { selectedActivities = new Set(all ? activities.map(a => String(a.activityId)) : []); await saveSelection(); render(); });
    selectionActions.append(button);
  }
  selector.append(selectionActions); output.append(selector);
  const omittedActivities = inferredUnusedActivities();
  if (omittedActivities.length) {
    const omitted = node('p', `Atividades não utilizadas omitidas: ${omittedActivities.map(activity => activity.name).join('; ')}. Motivo: questionário sem questões publicadas em todas as turmas.`);
    omitted.className = 'collection-note'; output.append(omitted);
  }
  const selected = selectedForAnalysis();
  for (const code of currentGroups) {
    const students = groupMatrix(report, code);
    const analysis = pendingAnalysis(report, code, selected);
    const feedbackActivities = activities.filter(activity => feedbackRequiredActivities.has(String(activity.activityId)));
    const feedbackPending = feedbackPendingAnalysis(report, code, feedbackActivities);
    const calculatedRnpAttention = rnpAttentionAnalysis(rnpReport, code, students, rnpAttentionPercent);
    const rnpAttention = includeRnpAttention ? calculatedRnpAttention : { ...calculatedRnpAttention, sampleCount: 0, students: [] };
    const pendingIds = new Set(analysis.pending.map(student => student.userId));
    const attentionIds = new Set(rnpAttention.students.map(student => student.userId));
    const hasAnalysis = Boolean(selected.length || (includeRnpAttention && calculatedRnpAttention.available));
    const displayedStudents = showOnlyPending && hasAnalysis ? students.filter(student => pendingIds.has(student.userId) || attentionIds.has(student.userId)) : students;
    const details = document.createElement('details');
    details.dataset.group = code; details.open = openGroups.has(code);
    const averageLabel = calculatedRnpAttention.sampleCount ? `${calculatedRnpAttention.averagePercent}% de participação média em tempo` : 'participação média em tempo indisponível';
    details.append(node('summary', `${code} — ${countLabel(students.length, 'aluno', 'alunos')} · ${countLabel(analysis.pending.length, 'com entrega pendente', 'com entregas pendentes')} · ${countLabel(feedbackPending.pending.length, 'com feedback pendente', 'com feedbacks pendentes')} · ${countLabel(rnpAttention.students.length, 'com pendência/atenção RNP', 'com pendência/atenção RNP')} · ${averageLabel}`));
    if (feedbackPending.uncoveredActivities.length) details.append(node('p', `Cobertura de feedback pendente: ${feedbackPending.uncoveredActivities.map(activity => activity.name).join('; ')}. Execute uma nova coleta de entregas.`));
    const jobs = report.results.filter(r => r.group.code === code);
    for (const job of jobs.filter(j => j.error && activities.some(activity => String(activity.activityId) === String(j.activityId)))) {
      const activity = activities.find(a => a.activityId === job.activityId);
      details.append(node('p', `${activity?.name || job.activityId}: ${job.error}`));
    }
    const wrap = document.createElement('div'); wrap.className = 'table-wrap';
    const table = document.createElement('table');
    const head = document.createElement('thead'); const header = document.createElement('tr');
    const durationList = calculatedRnpAttention.sessionDurations.map(item => item.minutes === null ? (item.raw || 'indisponível') : `${item.minutes} min`).join('; ');
    const rnpHeader = node('th', 'Presenças RNP');
    if (durationList) rnpHeader.append(document.createElement('br'), document.createTextNode(`(${durationList})`));
    rnpHeader.append(document.createElement('br'), document.createTextNode(`Participação: ${calculatedRnpAttention.participationPercent}%`));
    if (calculatedRnpAttention.sampleCount) rnpHeader.append(document.createElement('br'), document.createTextNode(`Tempo médio: ${calculatedRnpAttention.averagePercent}%`));
    header.append(node('th', 'Aluno'), rnpHeader, ...activities.map(a => {
      const completion = activityCompletion(students, a.activityId);
      const th = node('th', a.name); th.append(document.createElement('br'), document.createTextNode(`Finalização: ${completion.percent}%`));
      th.title = `${completion.completed}/${completion.total} alunos com conclusão ou envio registrado`;
      if (selectedActivities.has(String(a.activityId))) th.className = 'selected-activity'; return th;
    }));
    head.append(header); table.append(head);
    const body = document.createElement('tbody');
    for (const student of displayedStudents) {
      const pending = analysis.pending.find(item => item.userId === student.userId);
      const attention = rnpAttention.students.find(item => item.userId === student.userId);
      const row = document.createElement('tr');
      if (pending || attention?.status === 'not_found') row.className = 'has-pending';
      else if (attention) row.className = 'has-attention';
      row.append(node('td', student.name));
      const presence = node('td', attendanceForStudent(rnpReport, code, student, students)); presence.className = 'rnp-presence';
      if (attention) {
        presence.classList.add(attention.status === 'not_found' ? 'missing-attendance' : 'short-attendance');
        presence.title = attention.status === 'not_found' ? 'Pendência RNP: aluno não localizado pelo ID Moodle nem pelo nome' : `${attention.percent}% do tempo das sessões; limiar: ${rnpAttention.cutoffPercent}%`;
      }
      row.append(presence);
      for (const activity of activities) {
        const state = stateForActivity(report, code, student, activity);
        const job = report.results.find(result => result.group.code === code && String(result.activityId) === String(activity.activityId));
        const statusLabel = STATUS_LABELS[state?.status] || 'Sem evidência';
        const td = document.createElement('td');
        td.append(statusLink(statusLabel, activity, code, student.userId));
        td.title = state?.evidence || 'Ausência de resultado não comprova falta ou não entrega';
        if (!state && !job) {
          const collectLink = node('button', 'Realizar coleta');
          collectLink.type = 'button'; collectLink.className = 'status-link inline-collect';
          collectLink.title = `Coletar ${activity.name} para ${code}`;
          collectLink.addEventListener('click', () => collect({ retry: true }));
          td.append(document.createTextNode(' '), collectLink);
        }
        if (pending?.missing.some(item => String(item.activity.activityId) === String(activity.activityId))) td.className = 'pending-delivery';
        else if (selectedActivities.has(String(activity.activityId))) td.className = 'selected-activity';
        row.append(td);
      }
      body.append(row);
    }
    if (!displayedStudents.length) {
      const empty = document.createElement('tr'); const td = node('td', hasAnalysis ? 'Nenhum aluno com pendência explícita ou presença curta.' : 'Selecione atividades ou colete o RNP para aplicar o filtro.');
      td.colSpan = activities.length + 2; td.className = 'empty-result'; empty.append(td); body.append(empty);
    }
    table.append(body); wrap.append(table); details.append(wrap);
    if (feedbackActivities.length) {
      details.append(node('h3', 'Entregas concluídas aguardando feedback'));
      const feedbackWrap = document.createElement('div'); feedbackWrap.className = 'table-wrap feedback-table';
      const feedbackTable = document.createElement('table');
      const feedbackHead = document.createElement('thead'); const feedbackHeader = document.createElement('tr');
      feedbackHeader.append(node('th', 'Aluno'), ...feedbackActivities.map(activity => node('th', activity.name)));
      feedbackHead.append(feedbackHeader); feedbackTable.append(feedbackHead);
      const feedbackBody = document.createElement('tbody');
      for (const student of feedbackPending.pending) {
        const feedbackRow = document.createElement('tr'); feedbackRow.className = 'has-pending'; feedbackRow.append(node('td', student.name));
        for (const activity of feedbackActivities) {
          const pendingActivity = student.activities.find(item => String(item.activityId) === String(activity.activityId));
          const isPending = Boolean(pendingActivity);
          const days = pendingActivity ? Math.floor((Date.now() - Date.parse(pendingActivity.submittedAt)) / 86_400_000) : null;
          const validDays = Number.isFinite(days) && days >= 0 ? days : null;
          const feedbackCell = document.createElement('td');
          const feedbackLabel = isPending ? `Feedback pendente\n${validDays === null ? 'Tempo indisponível' : waitingDaysLabel(validDays)}` : '—';
          feedbackCell.append(isPending ? statusLink(feedbackLabel, activity, code, student.userId) : document.createTextNode('—'));
          if (isPending) feedbackCell.className = 'pending-feedback'; feedbackRow.append(feedbackCell);
        }
        feedbackBody.append(feedbackRow);
      }
      if (!feedbackPending.pending.length) {
        const feedbackRow = document.createElement('tr');
        const feedbackCell = node('td', feedbackPending.uncoveredActivities.length ? 'Aguardando nova coleta para avaliar o feedback.' : 'Nenhuma entrega concluída sem feedback localizado.');
        feedbackCell.colSpan = feedbackActivities.length + 1; feedbackCell.className = 'empty-result'; feedbackRow.append(feedbackCell); feedbackBody.append(feedbackRow);
      }
      feedbackTable.append(feedbackBody); feedbackWrap.append(feedbackTable); details.append(feedbackWrap);
    }
    const contact = whatsappContacts[code] || {};
    const contactBox = document.createElement('div'); contactBox.className = 'whatsapp-box';
    const title = node('strong', 'Mensagem para o contato da turma');
    const nameLabel = document.createElement('label'); nameLabel.append(document.createTextNode('Nome do contato '));
    const nameInput = document.createElement('input'); nameInput.type = 'text'; nameInput.value = contact.name || ''; nameInput.placeholder = 'Ex.: Facilitadora Maria'; nameLabel.append(nameInput);
    const phoneLabel = document.createElement('label'); phoneLabel.append(document.createTextNode('WhatsApp com DDI '));
    const phoneInput = document.createElement('input'); phoneInput.type = 'tel'; phoneInput.inputMode = 'tel'; phoneInput.value = contact.phone || ''; phoneInput.placeholder = '5531999999999'; phoneLabel.append(phoneInput);
    const feedback = node('span', ''); feedback.className = 'contact-feedback';
    const persist = async () => saveContact(code, { name: nameInput.value.trim(), phone: phoneInput.value.trim() });
    nameInput.addEventListener('change', persist); phoneInput.addEventListener('change', persist);
    const exportEnabled = hasAnalysis || feedbackActivities.length > 0;
    const exportPayload = () => {
      const deliveryAnalysis = pendingAnalysis(report, code, selectedForAnalysis());
      const completeAnalysis = { ...deliveryAnalysis, rnpAttention, feedbackPending };
      const updatedAt = formatUpdatedAt();
      return {
        analysis: completeAnalysis, updatedAt,
        message: buildPendingMessage({ courseCode: currentCourse.moduleCode, groupCode: code, contactName: nameInput.value, analysis: completeAnalysis, updatedAt }),
        rows: pendingExportRows(completeAnalysis),
      };
    };
    const exportTable = node('button', 'Exportar tabela CSV'); exportTable.type = 'button'; exportTable.className = 'secondary'; exportTable.disabled = !exportEnabled;
    exportTable.addEventListener('click', async () => {
      await persist(); const payload = exportPayload();
      const lines = [['Bloco','Aluno','Tipo','Item','Detalhe'], ...payload.rows.map(row => [row.block,row.student,row.type,row.item,row.detail]), [], ['Dados atualizados em',payload.updatedAt]];
      downloadBlob(new Blob(['\ufeff' + lines.map(line => line.map(csvCell).join(';')).join('\r\n')], {type:'text/csv;charset=utf-8'}), `${safeFilename(currentCourse.moduleCode)}-${safeFilename(code)}-pendencias.csv`);
      feedback.textContent = 'Tabela CSV exportada.';
    });
    const exportImage = node('button', 'Exportar imagem PNG'); exportImage.type = 'button'; exportImage.className = 'secondary'; exportImage.disabled = !exportEnabled;
    exportImage.addEventListener('click', async () => {
      await persist(); const payload = exportPayload();
      const blob = await messageImage(payload.message, `${currentCourse.moduleCode} — ${code}`);
      if (!blob) { feedback.textContent = 'Não foi possível gerar a imagem.'; return; }
      downloadBlob(blob, `${safeFilename(currentCourse.moduleCode)}-${safeFilename(code)}-pendencias.png`);
      feedback.textContent = 'Imagem PNG exportada.';
    });
    const exportText = node('button', 'Exportar mensagem TXT'); exportText.type = 'button'; exportText.className = 'secondary'; exportText.disabled = !exportEnabled;
    exportText.addEventListener('click', async () => {
      await persist(); const payload = exportPayload();
      downloadBlob(new Blob([payload.message], {type:'text/plain;charset=utf-8'}), `${safeFilename(currentCourse.moduleCode)}-${safeFilename(code)}-mensagem.txt`);
      feedback.textContent = 'Mensagem de texto exportada.';
    });
    const copyMessage = node('button', 'Copiar mensagem'); copyMessage.type = 'button'; copyMessage.className = 'secondary'; copyMessage.disabled = !exportEnabled;
    copyMessage.addEventListener('click', async () => {
      await persist();
      const copied = await copyToClipboard(exportPayload().message);
      feedback.textContent = copied ? 'Mensagem copiada para a área de transferência.' : 'Não foi possível copiar a mensagem. Use “Exportar mensagem TXT”.';
    });
    const whatsapp = node('button', 'Abrir mensagem no WhatsApp'); whatsapp.type = 'button';
    whatsapp.disabled = !exportEnabled;
    whatsapp.addEventListener('click', async () => {
      const phone = normalizeWhatsAppPhone(phoneInput.value);
      if (!phone) { feedback.textContent = 'Informe o número com DDI e DDD, usando de 10 a 15 dígitos.'; phoneInput.focus(); return; }
      if (!selected.length && !rnpAttention.sampleCount && !feedbackActivities.length) { feedback.textContent = 'Selecione uma atividade ou colete o RNP.'; return; }
      await persist();
      const message = exportPayload().message;
      const url = buildWhatsAppUrl(phone, message);
      const fallback = async reason => {
        const copied = await copyToClipboard(message);
        if (!copied) {
          feedback.textContent = `${reason} Não foi possível copiar automaticamente; use “Exportar mensagem TXT”.`;
          return;
        }
        feedback.textContent = `${reason} A mensagem já foi copiada. Abra a conversa e cole o texto para enviar.`;
        try { await chrome.tabs.create({ url: `https://wa.me/${phone}` }); } catch { /* Clipboard copy is still available. */ }
      };
      if (url.length > 8000) {
        await fallback('A mensagem é muito extensa para envio automático.');
        return;
      }
      try {
        await chrome.tabs.create({ url });
        feedback.textContent = 'Abrindo o WhatsApp. Confira a mensagem antes de enviar.';
      } catch {
        await fallback('Não foi possível abrir o envio automático.');
      }
    });
    contactBox.append(title, nameLabel, phoneLabel, whatsapp, copyMessage, exportTable, exportImage, exportText, feedback);
    details.append(contactBox); output.append(details);
  }
  const omittedIds = new Set(omittedActivities.map(activity => String(activity.activityId)));
  const consideredResults = report.results.filter(result => !omittedIds.has(String(result.activityId)));
  const consideredTotal = currentGroups.length * activities.length;
  const successful = consideredResults.filter(result => result.complete && !result.error).length;
  const retryCount = Math.max(0, consideredTotal - successful);
  const status = document.querySelector('#moodle-status');
  const omittedText = omittedActivities.length ? ` ${omittedActivities.length} ${omittedActivities.length === 1 ? 'atividade não utilizada omitida' : 'atividades não utilizadas omitidas'}.` : '';
  const retryLabel = `${retryCount} ${retryCount === 1 ? 'pendência ou falha' : 'pendências ou falhas'}`;
  status.replaceChildren(document.createTextNode(retryCount ? `${successful}/${consideredTotal} consultas válidas. Coleta com ${retryLabel}.${omittedText} ` : `${successful}/${consideredTotal} consultas válidas. Coleta concluída sem pendências.${omittedText} Dados atualizados: ${formatUpdatedAt()}.`));
  if (retryCount) {
    const retryLink = node('button', 'Repetir pendências'); retryLink.type = 'button'; retryLink.className = 'status-link'; retryLink.addEventListener('click', () => collect({ retry: true }));
    status.append(retryLink, document.createTextNode(` · Dados atualizados: ${formatUpdatedAt()}.`));
  }
  status.classList.toggle('has-warning', retryCount > 0);
  showAge(document.querySelector('#moodle-age'), 'Atividades — dado mais antigo', oldestSuccessfulTimestamp(report.results, report.collectedAt));
  document.querySelector('#export-moodle').disabled = !report.results.length;
}
document.querySelector('#stop-moodle').addEventListener('click', () => { stopRequested = true; });
async function collect({ retry = false } = {}) {
  if (running || !currentCourse) return;
  running = true; stopRequested = false;
  const button = document.querySelector('#collect-moodle'); button.disabled = true;
  document.querySelector('#stop-moodle').disabled = false;
  const status = document.querySelector('#moodle-status');
  status.classList.add('is-loading'); status.classList.remove('has-warning'); status.setAttribute('aria-busy', 'true');
  try {
    status.textContent = 'Identificando os dez grupos do curso…';
    const discovered = await send({type:'READ_MOODLE',courseId:currentCourse.courseId}, resumeCollection);
    if (discovered.error) throw new Error(discovered.error);
    if (discovered.activities) {
      currentCourse.activities = discovered.activities;
      // Keep the grades selector labels in step with the refreshed names.
      for (const option of document.querySelectorAll('#evaluation-scope option')) {
        const activity = discovered.activities.find(item => String(item.activityId) === option.value);
        if (activity) option.textContent = activity.name;
      }
    }
    const activities = allSupportedActivities();
    const total = discovered.groups.length * activities.length;
    const unusedIds = new Set(inferredUnusedActivities().map(activity => String(activity.activityId)));
    const preserved = retry && report?.courseId === currentCourse.courseId
      ? report.results.filter(result => {
        if (unusedIds.has(String(result.activityId))) return true;
        const needsDates = feedbackRequiredActivities.has(String(result.activityId)) && (result.records || []).some(record => ['submitted','finished','recorded'].includes(record.status) && !record.submittedAt);
        return result.complete && !result.error && !needsDates;
      }) : [];
    report = { courseId: currentCourse.courseId, collectedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), total, results: preserved, finished: false };
    for (const group of discovered.groups) {
      for (const activity of activities) {
        if (stopRequested) break;
        if (report.results.some(r => r.group.code === group.code && r.activityId === activity.activityId)) continue;
        status.textContent = `${report.results.length + 1}/${total}: ${group.code} · ${activity.name}. Aguarde até 45 s por tentativa.`;
        const result = await send({type:'READ_MOODLE',courseId:currentCourse.courseId,activityId:activity.activityId,group,evaluations:feedbackRequiredActivities.has(String(activity.activityId))}, resumeCollection);
        if (result.complete && feedbackRequiredActivities.has(String(activity.activityId))) {
          for (const row of result.evaluationRows || []) {
            if (!row.detailUrl || String(row.feedback || '').trim()) continue;
            status.textContent = `${group.code} · ${activity.name}: verificando feedback completo de ${row.name || `aluno ${row.userId}`}…`;
            const detail = await send({type:'READ_MOODLE',courseId:currentCourse.courseId,activityId:activity.activityId,group,detailUrl:row.detailUrl}, resumeCollection);
            if (detail.error) row.detailError = detail.error;
            else row.details = detail.details;
          }
        }
        report.results.push({...result,group,activityId:activity.activityId,queriedAt:new Date().toISOString()});
        report.updatedAt = new Date().toISOString();
        await chrome.storage.local.set({[`moodleReport:${currentCourse.courseId}`]:report});
      }
      if (stopRequested) break;
    }
    report.finished = !stopRequested;
    report.updatedAt = new Date().toISOString();
    await chrome.storage.local.set({[`moodleReport:${currentCourse.courseId}`]:report});
    render();
  } catch (error) {
    if (report) render();
    status.textContent = `Coleta parcial: ${error.message}`;
    status.classList.add('has-warning');
  } finally {
    running = false; button.disabled = false; document.querySelector('#stop-moodle').disabled = true;
    status.classList.remove('is-loading'); status.removeAttribute('aria-busy');
  }
}
const resumeCollection = () => collect({ retry: true });
document.querySelector('#collect-moodle').addEventListener('click', () => collect());
document.querySelector('#export-moodle').addEventListener('click', () => {
  if (!report) return;
  const lines = [['Grupo','Aluno','ID Moodle','Presenças RNP','Atividade','Situação']];
  const activities = supportedActivities();
  for (const group of currentGroups) for (const student of groupMatrix(report,group)) for (const activity of activities) {
    const state = stateForActivity(report, group, student, activity);
    lines.push([group,student.name,student.userId,attendanceForStudent(rnpReport,group,student,groupMatrix(report,group)),activity.name,STATUS_LABELS[state?.status] || 'Sem evidência']);
  }
  const url = URL.createObjectURL(new Blob(['\ufeff' + lines.map(line => line.map(csvCell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
  const a = document.createElement('a'); a.href = url; a.download = `${currentCourse.moduleCode}-atividades.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
});
