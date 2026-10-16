import { initMoodleReport, refreshMoodleRnpReport } from './moodle-report.js';
import { initEvaluationReport } from './evaluation-report.js';
import { showAge, refreshAges } from './lib/time-age.js';
import { ORIGINS } from './lib/config.js';
import { ENGAGEMENT_COLUMNS } from './lib/rnp-engagement.js';
import { csvCell } from './lib/report-model.js';

function cell(text, className = "") {
  const element = document.createElement("td");
  element.textContent = text;
  element.className = className;
  return element;
}
const countLabel = (count, singular, plural) => `${count} ${count === 1 ? singular : plural}`;
let moduleCode = '';
let rnpReport = null;

async function load() {
  const result = await chrome.runtime.sendMessage({ type: "GET_SELECTED_COURSE" });
  if (result.error) {
    document.querySelector("main").textContent = result.error;
    return;
  }

  const { course, groups, availableGroups } = result;
  moduleCode = course.moduleCode;
  const selection = document.querySelector('#group-selection');
  selection.replaceChildren(...availableGroups.map(code => {
    const label = document.createElement('label'); const input = document.createElement('input');
    input.type = 'checkbox'; input.value = code; input.checked = groups.includes(code); label.append(input, document.createTextNode(code)); return label;
  }));
  const collectionIds = ['collect-moodle','collect-rnp','evaluation-start','evaluation-refresh'];
  for (const id of collectionIds) document.querySelector(`#${id}`).disabled = !groups.length;
  document.querySelector('#group-selection-status').textContent = groups.length ? `${groups.length} ${groups.length === 1 ? 'turma selecionada' : 'turmas selecionadas'}.` : 'Selecione ao menos uma turma e aplique a seleção antes de coletar.';
  document.querySelector('#save-groups').onclick = async () => {
    const chosen = [...selection.querySelectorAll('input:checked')].map(input => input.value);
    const saved = await chrome.runtime.sendMessage({type:'SELECT_GROUPS',groups:chosen});
    if (saved.error) { document.querySelector('#group-selection-status').textContent = saved.error; return; }
    location.reload();
  };
  await initMoodleReport(course, groups);
  await initEvaluationReport(course, groups);
  document.querySelector("#course-code").textContent = course.moduleCode;
  document.querySelector("#course-name").textContent = course.discipline;
  document.querySelector("#summary").textContent = `${course.activities.length} atividades · ${groups.length} turmas`;

  document.querySelector("#groups").replaceChildren(
    ...groups.map((group) => {
      const item = document.createElement("span");
      item.className = "group";
      item.textContent = group;
      return item;
    }),
  );

  const saved = await chrome.runtime.sendMessage({ type: "GET_RNP_REPORT" });
  if (saved.report) showRnpSummary(saved.report);
}

function showRnpSummary(report) {
  rnpReport = report;
  const engagements = report.groups.reduce((total, group) => total + group.meetings.filter(meeting => meeting.engagement).length, 0);
  document.querySelector('#export-rnp-engagement').disabled = !engagements;
  const meetings = report.groups.reduce((total, group) => total + group.meetings.length, 0);
  const records = report.groups.reduce(
    (total, group) => total + group.meetings.reduce(
      (subtotal, meeting) => subtotal + meeting.attendance.length, 0), 0);
  document.querySelector("#rnp-status").textContent =
    `${countLabel(meetings, 'sessão', 'sessões')} e ${countLabel(records, 'registro de presença', 'registros de presença')}. Engajamento: ${engagements}/${meetings} sessões. ${countLabel(report.groups.filter(group => group.error).length, 'falha de grupo', 'falhas de grupo')}. Coleta: ${new Date(report.collectedAt).toLocaleString('pt-BR')}.`;
  showAge(document.querySelector('#rnp-age'), 'RNP — dado mais antigo', report.collectedAt);

  const breakdown = document.querySelector("#rnp-breakdown");
  const table = document.createElement("table");
  const head = document.createElement("thead");
  head.innerHTML = "<tr><th>Grupo</th><th>Sessões</th><th>Registros de presença</th></tr>";
  const body = document.createElement("tbody");
  for (const group of report.groups) {
    const row = document.createElement("tr");
    const groupRecords = group.meetings.reduce(
      (total, meeting) => total + meeting.attendance.length,
      0,
    );
    row.append(
      cell(group.groupCode),
      cell(String(group.meetings.length)),
      cell(String(groupRecords)),
    );
    body.append(row);
  }
  const foot = document.createElement("tfoot");
  const totalRow = document.createElement("tr");
  totalRow.append(cell("Total"), cell(String(meetings)), cell(String(records)));
  foot.append(totalRow);
  table.append(head, body, foot);
  breakdown.replaceChildren(table);
  breakdown.append(Object.assign(document.createElement('p'), {textContent:'Registros por sessão; uma pessoa pode aparecer em vários encontros. Ausência nesta lista ainda não é confirmação de falta.'}));
  for (const group of report.groups) {
    const details = document.createElement('details');
    details.append(Object.assign(document.createElement('summary'), {textContent: group.groupCode}));
    if (group.error) details.append(Object.assign(document.createElement('p'), {textContent:group.error}));
    for (const meeting of group.meetings) {
      details.append(Object.assign(document.createElement('h3'), {textContent:`${meeting.date} ${meeting.time} · ${meeting.title} · duração: ${meeting.duration || 'indisponível'}`}));
      const sessionTable = document.createElement('table');
      const header = document.createElement('thead');
      header.innerHTML = '<tr><th>Participante</th><th>Entrada</th><th>Saída</th><th>Duração</th></tr>';
      const rows = document.createElement('tbody');
      for (const person of meeting.attendance || []) {
        const row = document.createElement('tr');
        row.append(cell(person.name),cell(person.joinedAt),cell(person.leftAt),cell(person.duration));
        rows.append(row);
      }
      sessionTable.append(header,rows); details.append(sessionTable);
      if (meeting.engagementError) details.append(Object.assign(document.createElement('p'), {textContent:`Engajamento: ${meeting.engagementError}`}));
      if (meeting.engagement) {
        details.append(Object.assign(document.createElement('h4'), {textContent:`Engajamento · ${countLabel(meeting.engagement.polls, 'enquete', 'enquetes')} · compartilhamento de tela: ${Math.round(meeting.engagement.screenshareSeconds / 60)} min`}));
        const columns = ENGAGEMENT_COLUMNS.filter(([label]) => !['ID externo','Primeira entrada','Última saída'].includes(label));
        const engagementTable = document.createElement('table');
        const engagementHead = document.createElement('thead'); const headRow = document.createElement('tr');
        headRow.append(...columns.map(([label]) => Object.assign(document.createElement('th'), {textContent: label})));
        engagementHead.append(headRow);
        const engagementBody = document.createElement('tbody');
        for (const person of meeting.engagement.participants) {
          const row = document.createElement('tr');
          row.append(...columns.map(([, value]) => cell(String(value(person)))));
          engagementBody.append(row);
        }
        engagementTable.append(engagementHead, engagementBody);
        const wrap = document.createElement('div'); wrap.className = 'table-wrap'; wrap.append(engagementTable);
        details.append(wrap);
      }
    }
    breakdown.append(details);
  }
  breakdown.hidden = false;
}

document.querySelector("#collect-rnp").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const status = document.querySelector("#rnp-status");
  button.disabled = true;
  status.classList.add('is-loading'); status.setAttribute('aria-busy', 'true');
  status.textContent = "Coletando dez grupos sequencialmente; isto pode levar alguns minutos…";
  try {
    const result = await chrome.runtime.sendMessage({ type: "COLLECT_RNP_ATTENDANCE" });
    if (result.error) throw new Error(result.error);
    status.textContent = `${countLabel(result.meetingCount, 'sessão', 'sessões')} e ${countLabel(result.attendanceRecordCount, 'registro de presença', 'registros de presença')}. Engajamento: ${result.engagementCount}/${result.meetingCount} sessões. ${countLabel(result.errorCount, 'falha de grupo', 'falhas de grupo')}.`;
    const saved = await chrome.runtime.sendMessage({ type: "GET_RNP_REPORT" });
    if (saved.report) showRnpSummary(saved.report);
    await refreshMoodleRnpReport();
  } catch (error) {
    status.textContent = `Coleta interrompida: ${error.message}`;
    if (/sess[aã]o expirada|abra o (phila|moodle).*autenticad/i.test(error.message)) window.dispatchEvent(new CustomEvent('moodle-session-expired', { detail: { retry: () => button.click() } }));
  } finally {
    button.disabled = false;
    status.classList.remove('is-loading'); status.removeAttribute('aria-busy');
  }
});

document.querySelector('#export-rnp-engagement').addEventListener('click', () => {
  if (!rnpReport) return;
  const lines = [['Grupo', 'Sessão', 'Data', 'Horário', 'Duração da sessão', 'Início do registro', 'Fim do registro', 'Enquetes da sessão', ...ENGAGEMENT_COLUMNS.map(([label]) => label)]];
  for (const group of rnpReport.groups) for (const meeting of group.meetings) for (const person of meeting.engagement?.participants || []) {
    lines.push([group.groupCode, meeting.title, meeting.date, meeting.time, meeting.duration, meeting.engagement.startedAt, meeting.engagement.endedAt, meeting.engagement.polls, ...ENGAGEMENT_COLUMNS.map(([, value]) => value(person))]);
  }
  const url = URL.createObjectURL(new Blob(['\ufeff' + lines.map(line => line.map(csvCell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `${moduleCode}-engajamento-rnp.csv`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

load();
setInterval(() => refreshAges(document), 60_000);

const sessionDialog = document.querySelector('#session-expired-dialog');
const sessionMessage = document.querySelector('#session-dialog-message');
const loginButton = document.querySelector('#open-moodle-login');
const defaultSessionMessage = sessionMessage.textContent;
let resumeAfterLogin;
let stopWatchingLogin = () => {};
window.addEventListener('moodle-session-expired', event => {
  resumeAfterLogin = event.detail?.retry;
  if (sessionDialog.open) return;
  sessionMessage.textContent = defaultSessionMessage;
  sessionDialog.showModal();
});
sessionDialog.addEventListener('close', () => { stopWatchingLogin(); loginButton.disabled = false; });
async function returnAfterLogin() {
  const retry = resumeAfterLogin; resumeAfterLogin = undefined;
  const current = await chrome.tabs.getCurrent();
  await chrome.tabs.update(current.id, { active: true });
  await chrome.windows.update(current.windowId, { focused: true });
  sessionDialog.close();
  retry?.();
}
const moodleSessionActive = async () => (await chrome.runtime.sendMessage({ type: 'CHECK_MOODLE_SESSION' }))?.authenticated === true;
loginButton.onclick = async () => {
  loginButton.disabled = true;
  sessionMessage.textContent = 'Verificando a sessão do Moodle…';
  const { authenticated, loginUrl } = await chrome.runtime.sendMessage({ type: 'CHECK_MOODLE_SESSION' });
  if (authenticated) return returnAfterLogin();
  const loginTab = await chrome.tabs.create({ url: loginUrl });
  sessionMessage.textContent = 'Aguardando o login no Moodle. Depois de entrar, a extensão volta para este painel e retoma a coleta.';
  // Login can take minutes, so the report tab watches it instead of the short-lived service worker.
  const onUpdated = async (tabId, change, tab) => {
    if (tabId !== loginTab.id || change.status !== 'complete' || !tab.url?.startsWith(`${ORIGINS.moodle}/`) || /\/login\/|\/sso\/|selectsource|as_login/i.test(tab.url)) return;
    if (await moodleSessionActive()) await returnAfterLogin();
  };
  const onRemoved = tabId => {
    if (tabId !== loginTab.id) return;
    stopWatchingLogin(); loginButton.disabled = false;
    sessionMessage.textContent = 'A guia do Moodle foi fechada antes da confirmação do login. Abra o login novamente para continuar.';
  };
  stopWatchingLogin = () => { chrome.tabs.onUpdated.removeListener(onUpdated); chrome.tabs.onRemoved.removeListener(onRemoved); stopWatchingLogin = () => {}; };
  chrome.tabs.onUpdated.addListener(onUpdated);
  chrome.tabs.onRemoved.addListener(onRemoved);
};
document.querySelector('#close-session-dialog').onclick = () => { resumeAfterLogin = undefined; sessionDialog.close(); };
