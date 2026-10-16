// Summarizes the BigBlueButton learning dashboard JSON behind the RNP "Relatório de engajamento".
// All timestamps and durations in the source are milliseconds.

const ENGAGEMENT_HOST = "https://data-confweb-prd.s3.sa-east-1.amazonaws.com/";

// The report link points to a viewer page; the signed JSON URL is its `data` parameter.
export function engagementDataUrl(reportUrl) {
  try {
    const data = new URL(reportUrl).searchParams.get("data");
    return data?.startsWith(ENGAGEMENT_HOST) && new URL(data).pathname.endsWith("/learning_dashboard.json") ? data : null;
  } catch {
    return null;
  }
}

// Union of [start, end] intervals, so reconnections and overlapping webcams are not double-counted.
function coveredSeconds(intervals) {
  const sorted = intervals.filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start).sort((a, b) => a[0] - b[0]);
  let total = 0, currentStart = null, currentEnd = null;
  for (const [start, end] of sorted) {
    if (currentEnd === null || start > currentEnd) {
      if (currentEnd !== null) total += currentEnd - currentStart;
      currentStart = start; currentEnd = end;
    } else currentEnd = Math.max(currentEnd, end);
  }
  if (currentEnd !== null) total += currentEnd - currentStart;
  return Math.floor(total / 1000);
}

const clock = (seconds) => [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map((part) => String(part).padStart(2, "0")).join(":");
const iso = (value) => Number.isFinite(value) && value > 0 ? new Date(value).toISOString() : "";

// The same person can appear under several user keys after rejoining; the RNP dashboard merges them by external ID.
function mergeUsers(users) {
  const merged = new Map();
  for (const [key, user] of Object.entries(users)) {
    const id = String(user.extId || "") || `key:${user.userKey || key}`;
    const entry = merged.get(id) || {
      externalId: String(user.extId || ""), name: "", moderator: false, sessions: [], webcams: [], away: [],
      talkMs: 0, messages: 0, raisedHands: 0, reactions: 0, answers: new Set(), sharedNotes: 0, whiteboardAnnotations: 0,
    };
    entry.name ||= String(user.name || "");
    entry.moderator ||= Boolean(user.isModerator);
    entry.sessions.push(...Object.values(user.intIds || {}).flatMap((item) => item.sessions || []));
    entry.webcams.push(...(user.webcams || []));
    entry.away.push(...(user.away || []));
    entry.talkMs += Number(user.talk?.totalTime) || 0;
    entry.messages += Number(user.totalOfMessages) || 0;
    entry.raisedHands += (user.raiseHand || []).length;
    entry.reactions += (user.reactions || []).length;
    for (const poll of Object.keys(user.answers || {})) entry.answers.add(poll);
    entry.sharedNotes += Number(user.totalOfSharedNotes) || 0;
    entry.whiteboardAnnotations += Number(user.totalOfWhiteboardAnnotations) || 0;
    merged.set(id, entry);
  }
  return [...merged.values()];
}

// Same score as the RNP dashboard ("Pontuação de atividade", 0–10): talk, chat, raised hands and reactions
// each give up to 2 points relative to the most active non-moderator; poll answers up to 2 points. Moderators have none.
function activityScores(people, polls) {
  const learners = people.filter((person) => !person.moderator);
  const max = (field) => Math.max(0, ...learners.map((person) => person[field]));
  const maxima = { talkMs: max("talkMs"), messages: max("messages"), raisedHands: max("raisedHands"), reactions: max("reactions") };
  return people.map((person) => {
    if (person.moderator) return null;
    let points = Object.entries(maxima).reduce((total, [field, top]) => total + (top > 0 ? person[field] / top * 2 : 0), 0);
    if (polls > 0) points += person.answers.size / polls * 2;
    return Math.round(points * 10) / 10;
  });
}

export function summarizeRnpEngagement(data) {
  if (!data || typeof data !== "object" || !data.users || typeof data.users !== "object") {
    throw new Error("Relatório de engajamento não reconhecido.");
  }
  const endedOn = Number(data.endedOn) || null;
  const close = (start, stop) => [Number(start), Number(stop) || endedOn];
  const polls = Object.keys(data.polls || {}).length;
  const people = mergeUsers(data.users);
  const scores = activityScores(people, polls);
  const participants = people.map((person, index) => {
    const joins = person.sessions.map((session) => Number(session.registeredOn)).filter((value) => value > 0);
    const leaves = person.sessions.map((session) => Number(session.leftOn) || endedOn).filter((value) => value > 0);
    return {
      name: person.name,
      moodleUserId: /^\d+$/.test(person.externalId) ? person.externalId : "",
      externalId: person.externalId,
      moderator: person.moderator,
      firstJoinedAt: iso(Math.min(...joins)),
      lastLeftAt: iso(Math.max(...leaves)),
      connections: person.sessions.length,
      onlineSeconds: coveredSeconds(person.sessions.map((session) => close(session.registeredOn, session.leftOn))),
      talkSeconds: Math.floor(person.talkMs / 1000),
      webcamSeconds: coveredSeconds(person.webcams.map((webcam) => close(webcam.startedOn, webcam.stoppedOn))),
      awaySeconds: coveredSeconds(person.away.map((away) => close(away.startedOn, away.stoppedOn))),
      messages: person.messages,
      raisedHands: person.raisedHands,
      reactions: person.reactions,
      pollAnswers: person.answers.size,
      sharedNotes: person.sharedNotes,
      whiteboardAnnotations: person.whiteboardAnnotations,
      activityScore: scores[index],
    };
  }).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return {
    startedAt: iso(Number(data.createdOn)),
    endedAt: iso(endedOn),
    polls,
    screenshareSeconds: coveredSeconds((data.screenshares || []).map((share) => close(share.startedOn, share.stoppedOn))),
    participants,
  };
}

export const ENGAGEMENT_COLUMNS = [
  ["Participante", (person) => person.name],
  ["ID Moodle", (person) => person.moodleUserId],
  ["ID externo", (person) => person.externalId],
  ["Moderador", (person) => person.moderator ? "Sim" : "Não"],
  ["Primeira entrada", (person) => person.firstJoinedAt],
  ["Última saída", (person) => person.lastLeftAt],
  ["Conexões", (person) => person.connections],
  ["Tempo online", (person) => clock(person.onlineSeconds)],
  ["Tempo de fala", (person) => clock(person.talkSeconds)],
  ["Tempo de câmera", (person) => clock(person.webcamSeconds)],
  ["Tempo ausente", (person) => clock(person.awaySeconds)],
  ["Mensagens no chat", (person) => person.messages],
  ["Mãos levantadas", (person) => person.raisedHands],
  ["Reações", (person) => person.reactions],
  ["Respostas a enquetes", (person) => person.pollAnswers],
  ["Notas compartilhadas", (person) => person.sharedNotes],
  ["Anotações no quadro", (person) => person.whiteboardAnnotations],
  ["Pontuação de atividade", (person) => person.activityScore === null ? "Indisponível" : String(person.activityScore).replace(".", ",")],
];
