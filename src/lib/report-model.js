export const STATUS_LABELS = {
  submitted: 'Enviou', not_submitted: 'Sem envio', draft: 'Rascunho',
  finished: 'Finalizou', in_progress: 'Em progresso', not_started: 'Sem tentativa',
  recorded: 'Registro encontrado', unknown: 'Indeterminado',
};
export function groupMatrix(report, code) {
  // Contributor lists (wiki history) also include staff, so they never add students on their own.
  const jobs = report.results.filter(r => r.group.code === code).sort((a, b) => Boolean(a.contributorsOnly) - Boolean(b.contributorsOnly));
  const students = new Map();
  const rank = { unknown: 0, not_started: 1, not_submitted: 1, draft: 2, in_progress: 2, recorded: 3, submitted: 3, finished: 3 };
  for (const job of jobs) {
    for (const record of job.records || []) {
      if (!record.userId) continue;
      let student = students.get(record.userId);
      if (!student && job.contributorsOnly) continue;
      if (!student) students.set(record.userId, student = { userId: record.userId, name: record.name || `Usuário ${record.userId}`, states: {} });
      if (record.name && !job.contributorsOnly) student.name = record.name;
      const previous = student.states[job.activityId];
      if (!previous || rank[record.status] > rank[previous.status]) student.states[job.activityId] = record;
    }
  }
  return [...students.values()].sort((a,b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export function stateForActivity(report, code, student, activity) {
  const state = student.states?.[activity.activityId];
  if (state) return state;
  const job = report.results.find(result => result.group.code === code && String(result.activityId) === String(activity.activityId));
  if (activity.type === 'diary' && job?.complete && !job.error) {
    return { status: 'not_submitted', evidence: 'Nenhum registro localizado no relatório completo do diário' };
  }
  if (activity.type === 'wiki' && job?.complete && !job.error) {
    return { status: 'not_submitted', evidence: 'Nenhuma edição localizada no histórico completo da wiki da turma' };
  }
  return undefined;
}
export function csvCell(value) {
  let safe = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(safe)) safe = `'${safe}`;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function attendanceForStudent(rnpReport, code, student, classmates) {
  const participation = rnpParticipationForStudent(rnpReport, code, student, classmates);
  if (participation.status !== 'recorded') return participation.label;
  const duration = participation.validSessionCount
    ? `${participation.totalMinutes} minutos (${participation.percent}% ${participation.sessionCount === 1 ? 'da sessão' : 'das sessões'})`
    : 'duração indisponível';
  const partial = participation.partialNameCount ? `\nnome parcial em ${participation.partialNameCount} ${participation.partialNameCount === 1 ? 'sessão' : 'sessões'}` : '';
  return `${participation.sessionCount} ${participation.sessionCount === 1 ? 'presença' : 'presenças'}\n${duration}${partial}`;
}

const normalizeName = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('pt-BR');

const NAME_CONNECTORS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E']);
const nameWords = value => normalizeName(value).replace(/[^A-Z\s]/g, ' ').split(/\s+/).filter(word => word.length > 2 && !NAME_CONNECTORS.has(word));
// Guests often type a shortened name ("Ana Souza"): same first name and every other word found in the full name.
const partialNameOf = (rnpName, fullName) => {
  const short = nameWords(rnpName), full = nameWords(fullName);
  return short.length >= 2 && short[0] === full[0] && short.slice(1).every(word => full.includes(word));
};

// Matches by Moodle ID first: the engagement report links each RNP display name to the Moodle ID of
// participants who joined through Moodle. The full name is the fallback (guests, sessions without engagement).
export function rnpParticipationForStudent(rnpReport, code, student, classmates) {
  const name = normalizeName(student.name);
  const uniqueName = Boolean(name) && classmates.filter(person => normalizeName(person.name) === name).length === 1;
  const group = rnpReport?.groups?.find(item => item.groupCode === code);
  if (!group || group.error || !group.meetings?.length) {
    return uniqueName ? { status: 'unavailable', label: 'Sem evidência RNP' } : { status: 'ambiguous', label: 'Nome ambíguo' };
  }
  const attended = [];
  for (const meeting of group.meetings) {
    const idNames = new Set((meeting.engagement?.participants || [])
      .filter(person => student.userId && person.moodleUserId === String(student.userId)).map(person => normalizeName(person.name)));
    let records = (meeting.attendance || []).filter(person => idNames.has(normalizeName(person.name)));
    if (!records.length && uniqueName) records = (meeting.attendance || []).filter(person => normalizeName(person.name) === name);
    let partial = false;
    if (!records.length) {
      // Only names that fit this student alone and match nobody exactly.
      records = (meeting.attendance || []).filter(person => !classmates.some(other => normalizeName(other.name) === normalizeName(person.name))
        && partialNameOf(person.name, student.name) && classmates.filter(other => partialNameOf(person.name, other.name)).length === 1);
      partial = records.length > 0;
    }
    if (!records.length) continue;
    const sessionSeconds = durationSeconds(meeting.duration);
    const recordDurations = records.map(person => durationSeconds(person.duration)).filter(value => value !== null);
    const recordedSeconds = recordDurations.length ? recordDurations.reduce((total, value) => total + value, 0) : null;
    attended.push({
      title: meeting.title || 'Sessão RNP', date: meeting.date || '', partial,
      sessionSeconds, recordedSeconds: sessionSeconds === null || recordedSeconds === null ? null : Math.min(recordedSeconds, sessionSeconds),
    });
  }
  if (!attended.length) return uniqueName ? { status: 'not_found', label: 'Não localizado no RNP' } : { status: 'ambiguous', label: 'Nome ambíguo' };
  const valid = attended.filter(item => item.sessionSeconds !== null && item.recordedSeconds !== null);
  const totalSessionSeconds = valid.reduce((total, item) => total + item.sessionSeconds, 0);
  const totalRecordedSeconds = valid.reduce((total, item) => total + item.recordedSeconds, 0);
  return {
    status: 'recorded', label: '', sessionCount: attended.length, validSessionCount: valid.length, partialNameCount: attended.filter(item => item.partial).length,
    totalMinutes: Math.round(totalRecordedSeconds / 60), totalSessionMinutes: Math.round(totalSessionSeconds / 60),
    percent: totalSessionSeconds ? Math.round(totalRecordedSeconds / totalSessionSeconds * 100) : null,
    sessions: valid.map(item => ({ ...item, minutes: Math.round(item.recordedSeconds / 60), percent: Math.round(item.recordedSeconds / item.sessionSeconds * 100) })),
  };
}

export function durationSeconds(value) {
  const text = String(value || '').trim().toLocaleLowerCase('pt-BR');
  let match = text.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    const hours = Number(match[1]), minutes = Number(match[2]), seconds = Number(match[3] || 0);
    return minutes > 59 || seconds > 59 ? null : hours * 3600 + minutes * 60 + seconds;
  }
  match = text.match(/^(?:(\d+)\s*(?:h|hora(?:s)?))?\s*(?:(\d+)\s*(?:m|min(?:uto)?(?:s)?))?\s*(?:(\d+)\s*(?:s|seg(?:undo)?(?:s)?))?$/i);
  if (match && match[0] && match.slice(1).some(value => value !== undefined)) {
    return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
  }
  match = text.match(/^pt(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (match) return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
  return null;
}

const UNUSED_ACTIVITY_ERRORS = new Set(['Questionário sem questões publicadas']);
export function unusedActivities(report, activities, groupCodes) {
  if (!report || !groupCodes?.length) return [];
  return activities.filter(activity => {
    const jobs = report.results.filter(result => String(result.activityId) === String(activity.activityId) && groupCodes.includes(result.group.code));
    return jobs.length === groupCodes.length && jobs.every(job => !job.complete && UNUSED_ACTIVITY_ERRORS.has(job.error));
  });
}

export function rnpAttentionAnalysis(rnpReport, code, students, cutoffPercent = 50) {
  const cutoff = Math.min(100, Math.max(0, Number(cutoffPercent) || 0));
  const group = rnpReport?.groups?.find(item => item.groupCode === code);
  const sessionDurations = (group?.meetings || []).map(meeting => ({
    title: meeting.title || 'Sessão RNP', raw: String(meeting.duration || '').trim(),
    minutes: durationSeconds(meeting.duration) === null ? null : Math.round(durationSeconds(meeting.duration) / 60),
  }));
  const evaluatedParticipations = students.map(student => ({ student, participation: rnpParticipationForStudent(rnpReport, code, student, students) }));
  const recordedParticipations = evaluatedParticipations
    .filter(item => item.participation.status === 'recorded');
  const participations = recordedParticipations.filter(item => item.participation.percent !== null);
  const averagePercent = participations.length
    ? Math.round(participations.reduce((total, item) => total + item.participation.percent, 0) / participations.length)
    : 0;
  const shortParticipations = participations.filter(item => item.participation.percent < cutoff).map(({ student, participation }) => ({
    userId: student.userId, name: student.name, percent: participation.percent,
    totalMinutes: participation.totalMinutes, totalSessionMinutes: participation.totalSessionMinutes,
    sessionCount: participation.sessionCount, sessions: participation.sessions, status: 'short',
  }));
  const notFound = evaluatedParticipations.filter(item => item.participation.status === 'not_found').map(({ student, participation }) => ({
    userId: student.userId, name: student.name, status: 'not_found', label: participation.label,
  }));
  return {
    cutoffPercent: cutoff, sampleCount: participations.length, averagePercent, sessionDurations,
    participationCount: recordedParticipations.length,
    participationPercent: students.length ? Math.round(recordedParticipations.length / students.length * 100) : 0,
    available: Boolean(group && !group.error && group.meetings?.length),
    students: [...shortParticipations, ...notFound],
  };
}

const COMPLETED_STATUSES = new Set(['submitted', 'finished', 'recorded']);
export function activityCompletion(students, activityId) {
  const completed = students.filter(student => COMPLETED_STATUSES.has(student.states?.[activityId]?.status)).length;
  return { completed, total: students.length, percent: students.length ? Math.round(completed / students.length * 100) : 0 };
}

function hasFeedbackEvidence(row) {
  if (!row) return false;
  if (String(row.feedback || '').trim()) return true;
  if ((row.details || []).some(detail => String(detail.feedback || '').trim())) return true;
  if ((row.pdf?.files || []).length) return true;
  if (row.pdf?.state === 'complete' && ((row.pdf.annotations || []).length || (row.pdf.comments || []).length)) return true;
  return false;
}

export function feedbackPendingAnalysis(report, code, activities) {
  const students = groupMatrix(report, code);
  const pending = [];
  const uncoveredActivities = [];
  for (const activity of activities) {
    const job = report.results.find(result => result.group.code === code && String(result.activityId) === String(activity.activityId));
    if (!job?.complete || !Array.isArray(job.evaluationRows)) {
      uncoveredActivities.push(activity);
      continue;
    }
    const evaluationByUser = new Map();
    for (const row of job.evaluationRows) {
      const id = String(row.userId || '');
      if (!id) continue;
      if (!evaluationByUser.has(id)) evaluationByUser.set(id, []);
      evaluationByUser.get(id).push(row);
    }
    for (const student of students) {
      if (!COMPLETED_STATUSES.has(student.states?.[activity.activityId]?.status)) continue;
      const rows = evaluationByUser.get(String(student.userId)) || [];
      if (rows.some(row => row.detailUrl && !Array.isArray(row.details))) {
        if (!uncoveredActivities.some(item => String(item.activityId) === String(activity.activityId))) uncoveredActivities.push(activity);
        continue;
      }
      if (!rows.some(hasFeedbackEvidence)) {
        let item = pending.find(candidate => candidate.userId === student.userId);
        if (!item) { item = { userId: student.userId, name: student.name, activities: [] }; pending.push(item); }
        item.activities.push({ ...activity, submittedAt: student.states?.[activity.activityId]?.submittedAt || rows.find(row => row.submittedAt)?.submittedAt || '' });
      }
    }
  }
  return { pending, uncoveredActivities };
}

export function fullDaysSince(value, now = Date.now()) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp > now) return null;
  return Math.floor((now - timestamp) / 86_400_000);
}

export function waitingDaysLabel(days) {
  return `há ${days} ${days <= 1 ? 'dia' : 'dias'}`;
}

const PENDING_STATUSES = new Set(['not_submitted', 'draft', 'not_started', 'in_progress']);
export function pendingAnalysis(report, code, activities) {
  const students = groupMatrix(report, code);
  const selected = new Map(activities.map(activity => [String(activity.activityId), activity]));
  const pending = [];
  let unresolved = 0;
  for (const student of students) {
    const missing = [];
    for (const [activityId, activity] of selected) {
      const state = stateForActivity(report, code, student, activity);
      if (PENDING_STATUSES.has(state?.status)) missing.push({ activity, status: state.status });
      else if (!state || state.status === 'unknown') unresolved++;
    }
    if (missing.length) pending.push({ ...student, missing });
  }
  const failedActivities = activities.filter(activity => {
    const job = report.results.find(result => result.group.code === code && String(result.activityId) === String(activity.activityId));
    return !job?.complete || Boolean(job.error);
  });
  return { pending, unresolved, failedActivities };
}

export function normalizeWhatsAppPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return /^\d{10,15}$/.test(digits) ? digits : '';
}

export function buildWhatsAppUrl(phone, message) {
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized) return '';
  return `https://wa.me/${normalized}?text=${encodeURIComponent(String(message || ''))}`;
}

function compactWhatsAppName(value) {
  const name = String(value || '').trim();
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length <= 2) return name;
  const middle = parts.slice(1, -1).map(part => `${[...part][0]}.`);
  return [parts[0], ...middle, parts.at(-1)].join(' ');
}

export function buildPendingMessage({ courseCode, groupCode, contactName, analysis, updatedAt }) {
  const lines = [];
  if (String(contactName || '').trim()) lines.push(`Olá, ${String(contactName).trim()}!`, '');
  lines.push(`Relatório de entregas pendentes — ${courseCode} — ${groupCode}`, '');
  const deliveryById = new Map(analysis.pending.map(student => [student.userId, student]));
  const attentionById = new Map((analysis.rnpAttention?.students || []).map(student => [student.userId, student]));
  const feedbackById = new Map((analysis.feedbackPending?.pending || []).map(student => [student.userId, student]));
  const studentIds = [...new Set([...deliveryById.keys(), ...attentionById.keys()])];
  const feedbackIds = [...feedbackById.keys()];
  if (studentIds.length) {
    lines.push('PENDÊNCIAS DO ALUNO');
    for (const id of studentIds) {
      const student = deliveryById.get(id) || attentionById.get(id);
      lines.push('', `• ${compactWhatsAppName(student.name)}`);
      for (const item of deliveryById.get(id)?.missing || []) lines.push(`  - Entrega: ${item.activity.name} (${STATUS_LABELS[item.status]})`);
      const attention = attentionById.get(id);
      if (attention?.status === 'not_found') lines.push('  - Presença RNP: Não localizado no RNP');
      else if (attention) lines.push(`  - Atenção RNP: ${attention.percent}% do tempo das sessões (${attention.totalMinutes}/${attention.totalSessionMinutes} min; limiar: ${analysis.rnpAttention.cutoffPercent}%)`);
    }
  }
  if (feedbackIds.length) {
    lines.push('', 'PENDÊNCIAS DO FACILITADOR — FEEDBACK');
    for (const id of feedbackIds) {
      const student = feedbackById.get(id);
      lines.push('', `• ${compactWhatsAppName(student.name)}`);
      for (const activity of student.activities || []) {
        const days = fullDaysSince(activity.submittedAt);
        lines.push(`  - Feedback pendente: ${activity.name}${days === null ? ' (tempo de espera indisponível)' : ` — ${waitingDaysLabel(days)}`}`);
      }
    }
  }
  if (!studentIds.length && !feedbackIds.length) lines.push('Não foram identificadas pendências de aluno, feedbacks pendentes ou presenças RNP abaixo do limiar configurado.');
  if (analysis.unresolved || analysis.failedActivities.length) {
    lines.push('', 'Observação: existem resultados sem evidência suficiente ou consultas pendentes que precisam de conferência no PHILA.');
  }
  lines.push('', `Dados atualizados em: ${updatedAt}`);
  return lines.join('\n');
}

export function pendingExportRows(analysis) {
  const rows = [];
  for (const student of analysis.pending || []) for (const item of student.missing || []) {
    rows.push({ block: 'Pendências do aluno', student: student.name, type: 'Entrega pendente', item: item.activity.name, detail: STATUS_LABELS[item.status] || item.status || '' });
  }
  for (const student of analysis.feedbackPending?.pending || []) for (const activity of student.activities || []) {
    const days = fullDaysSince(activity.submittedAt);
    rows.push({ block: 'Pendências do facilitador — feedback', student: student.name, type: 'Feedback pendente', item: activity.name, detail: days === null ? 'Tempo de espera indisponível' : waitingDaysLabel(days) });
  }
  for (const student of analysis.rnpAttention?.students || []) {
    rows.push(student.status === 'not_found'
      ? { block: 'Pendências do aluno', student: student.name, type: 'Pendência RNP', item: 'Presença', detail: 'Não localizado no RNP' }
      : { block: 'Pendências do aluno', student: student.name, type: 'Atenção RNP', item: 'Participação em tempo', detail: `${student.percent}% (${student.totalMinutes}/${student.totalSessionMinutes} min; limiar: ${analysis.rnpAttention.cutoffPercent}%)` });
  }
  return rows.sort((left, right) => left.student.localeCompare(right.student, 'pt-BR') || left.type.localeCompare(right.type, 'pt-BR'));
}
