import { ORIGINS } from "./lib/config.js";
import { resolveStudentDestination } from './lib/navigation-reader.js';
import { parseRnpParticipants, summarizeRnpAttendance } from "./lib/rnp-parser.js";
import { readMoodle } from './lib/moodle-reader.js';
import { readFeedbackDetail } from './lib/feedback-reader.js';
import { readPdfAnnotations, readPublishedPdf } from './lib/pdf-reader.js';
import { normalizePdfAnnotations } from './lib/pdf-model.js';

const REQUEST_TIMEOUT_MS = 45_000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function matchingTabs(origin) {
  return chrome.tabs.query({ url: `${origin}/*` });
}

async function connectionStatus() {
  const [phila, moodle, rnp] = await Promise.all([
    matchingTabs(ORIGINS.phila),
    matchingTabs(ORIGINS.moodle),
    matchingTabs(ORIGINS.rnp),
  ]);

  return {
    phila: phila.length > 0,
    moodle: moodle.length > 0,
    rnp: rnp.length > 0,
    groups: [],
  };
}

async function waitForTabComplete(tabId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < REQUEST_TIMEOUT_MS) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return tab;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("A página não terminou de carregar em 45 segundos.");
}

async function openForLogin(origin, existingTab) {
  return existingTab?.id
    ? chrome.tabs.update(existingTab.id, { url: origin, active: true })
    : chrome.tabs.create({ url: origin, active: true });
}

async function discoverPhilaCourses() {
  const [tab] = await matchingTabs(ORIGINS.phila);
  if (!tab?.id) {
    throw new Error("Abra o PHILA e mantenha a sessão autenticada.");
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: async () => {
      const response = await fetch("/homepage/procurar-dados-da-homepage", {
        method: "POST",
        credentials: "same-origin",
      });

      if (!response.ok) {
        throw new Error(`PHILA respondeu ${response.status}.`);
      }

      if (response.redirected || !response.headers.get('content-type')?.includes('application/json')) {
        throw new Error('Sessão expirada. Abra o PHILA autenticado em uma nova guia.');
      }

      const payload = await response.json();
      const rows = payload?.dados?.homepageSupervisor?.gruposDeTurma;
      if (!Array.isArray(rows)) {
        throw new Error("A lista de supervisão não foi encontrada no PHILA.");
      }

      return rows.flatMap((row) => {
        const match = row.nome?.match(/^(PMMFC\d+).*\/\s*([A-Z][A-Z0-9_-]+)\b/i);
        if (!match) return [];

        const moodle = new URL(row.linkMoodle);
        return [{
          groupRecordId: row.id,
          philaClassId: row.idTurma,
          moduleCode: match[1],
          groupCode: match[2],
          className: row.nome,
          discipline: row.disciplina,
          moodleUrl: moodle.href,
          moodleCourseId: moodle.searchParams.get("id"),
        }];
      });
    },
  });

  const discoveredAt = new Date().toISOString();
  const catalog = { discoveredAt, rows: result };
  await chrome.storage.local.set({ philaCatalog: catalog });

  return {
    discoveredAt,
    rowCount: result.length,
    moduleCodeCount: new Set(result.map((row) => row.moduleCode)).size,
    groupCount: new Set(result.map((row) => row.groupCode)).size,
    courseCount: new Set(result.map((row) => row.moodleCourseId)).size,
  };
}

async function discoverMoodleActivities() {
  const { philaCatalog } = await chrome.storage.local.get("philaCatalog");
  if (!philaCatalog?.rows?.length) {
    throw new Error("Mapeie primeiro as turmas do PHILA.");
  }

  const [tab] = await matchingTabs(ORIGINS.moodle);
  if (!tab?.id) {
    throw new Error("Abra um curso Moodle e mantenha a sessão autenticada.");
  }

  const courses = [...new Map(
    philaCatalog.rows.map((row) => [row.moodleCourseId, {
      courseId: row.moodleCourseId,
      url: row.moodleUrl,
      moduleCode: row.moduleCode,
      discipline: row.discipline,
    }]),
  ).values()];

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    args: [courses],
    func: async (courseList) => {
      const supported = new Set(["assign", "quiz", "diary", "lti", "page", "talking"]);

      async function inspectCourse(course) {
        const response = await fetch(course.url, { credentials: "same-origin" });
        if (!response.ok || response.url.includes("/login/")) {
          return { ...course, error: `HTTP ${response.status}`, activities: [] };
        }

        const documentCopy = new DOMParser().parseFromString(await response.text(), "text/html");
        const activities = [...documentCopy.querySelectorAll('a[href*="/mod/"]')].flatMap((link) => {
          const url = new URL(link.href, response.url);
          const match = url.pathname.match(/\/mod\/([^/]+)\//);
          const type = match?.[1];
          const activityId = url.searchParams.get("id");
          if (!supported.has(type) || !activityId) return [];

          const container = link.closest("li.activity, [data-for='cmitem'], .activity");
          const name = (
            container?.querySelector(".activityname, .instancename")?.textContent
            || link.textContent
            || ""
          ).replace(/\s+/g, " ").trim();

          return [{ type, activityId, name, url: url.href }];
        });

        return {
          ...course,
          title: documentCopy.title,
          activities: [...new Map(
            activities.map((activity) => [`${activity.type}:${activity.activityId}`, activity]),
          ).values()],
        };
      }

      const output = [];
      const queue = [...courseList];
      const workers = Array.from({ length: 3 }, async () => {
        while (queue.length) output.push(await inspectCourse(queue.shift()));
      });
      await Promise.all(workers);
      return output;
    },
  });

  const discoveredAt = new Date().toISOString();
  await chrome.storage.local.set({ moodleCatalog: { discoveredAt, courses: result } });

  const counts = result
    .flatMap((course) => course.activities)
    .reduce((summary, activity) => {
      summary[activity.type] = (summary[activity.type] || 0) + 1;
      return summary;
    }, {});

  return {
    discoveredAt,
    courseCount: result.length,
    failedCourseCount: result.filter((course) => course.error).length,
    activityCount: Object.values(counts).reduce((total, count) => total + count, 0),
    counts,
  };
}

async function connectSources() {
  let [philaTab] = await matchingTabs(ORIGINS.phila);
  if (!philaTab?.id) {
    await chrome.storage.local.set({ connectionFlow: { stage: 'phila', startedAt: new Date().toISOString() } });
    await openForLogin(ORIGINS.phila);
    return {
      connected: false,
      needsLogin: "phila",
      message: "O PHILA foi aberto. Entre na sua conta e depois clique novamente em Conectar.",
    };
  }

  let phila;
  try {
    phila = await discoverPhilaCourses();
  } catch (error) {
    await chrome.storage.local.set({ connectionFlow: { stage: 'phila', startedAt: new Date().toISOString() } });
    await openForLogin(ORIGINS.phila, philaTab);
    return {
      connected: false,
      needsLogin: "phila",
      message: "A sessão do PHILA precisa ser renovada. Entre na sua conta e depois clique novamente em Conectar.",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const { philaCatalog } = await chrome.storage.local.get("philaCatalog");
  const firstCourseUrl = philaCatalog?.rows?.find((row) => row.moodleUrl)?.moodleUrl;
  if (!firstCourseUrl) {
    throw new Error("Nenhum curso Moodle foi encontrado nas turmas do PHILA.");
  }

  let [moodleTab] = await matchingTabs(ORIGINS.moodle);
  if (!moodleTab?.id) {
    await chrome.storage.local.set({ connectionFlow: { stage: 'moodle', startedAt: new Date().toISOString() } });
    moodleTab = await chrome.tabs.create({ url: firstCourseUrl, active: false });
    await waitForTabComplete(moodleTab.id);
  }

  const moodle = await discoverMoodleActivities();
  if (moodle.courseCount > 0 && moodle.failedCourseCount === moodle.courseCount) {
    await chrome.storage.local.set({ connectionFlow: { stage: 'moodle', startedAt: new Date().toISOString() } });
    await chrome.tabs.update(moodleTab.id, { url: firstCourseUrl, active: true });
    return {
      connected: false,
      needsLogin: "moodle",
      message: "O Moodle foi aberto para concluir o acesso. Entre, se solicitado, e depois clique novamente em Conectar.",
    };
  }

  await chrome.storage.local.remove('connectionFlow');

  return {
    connected: true,
    phila,
    moodle,
    message: `${phila.groupCount} turmas e ${moodle.activityCount} atividades estão prontas.`,
  };
}

async function getCourseOptions() {
  const { moodleCatalog, selectedCourseId } = await chrome.storage.local.get([
    "moodleCatalog", "selectedCourseId",
  ]);

  const courses = (moodleCatalog?.courses || [])
    .map((course) => ({
      courseId: String(course.courseId),
      moduleCode: course.moduleCode,
      discipline: course.discipline,
      activityCount: course.activities.length,
    }))
    .sort((left, right) => left.moduleCode.localeCompare(right.moduleCode, "pt-BR", { numeric: true }));

  return { courses, selectedCourseId: selectedCourseId || "" };
}

async function selectCourse(message) {
  const courseId = String(message.courseId || "");
  const { moodleCatalog } = await chrome.storage.local.get("moodleCatalog");
  const exists = moodleCatalog?.courses?.some((course) => String(course.courseId) === courseId);
  if (!exists) throw new Error("Curso Moodle não encontrado no catálogo local.");

  await chrome.storage.local.set({ selectedCourseId: courseId });
  return { courseId };
}

async function getSelectedCourse() {
  const { moodleCatalog, philaCatalog, selectedCourseId, selectedGroupsByCourse } = await chrome.storage.local.get([
    "moodleCatalog",
    "philaCatalog",
    "selectedCourseId",
    "selectedGroupsByCourse",
  ]);
  const course = moodleCatalog?.courses?.find(
    (item) => String(item.courseId) === String(selectedCourseId),
  );
  if (!course) throw new Error("Selecione um curso no popup da extensão.");
  const availableGroups = [...new Set((philaCatalog?.rows || []).filter(row => String(row.moodleCourseId) === String(course.courseId)).map(row => row.groupCode))].sort();
  const groups = (selectedGroupsByCourse?.[String(course.courseId)] || []).filter(code => availableGroups.includes(code));
  return { course, groups, availableGroups };
}

async function selectGroups(message) {
  const { course, availableGroups } = await getSelectedCourse();
  const groups = [...new Set((message.groups || []).map(String))];
  if (groups.some(code => !availableGroups.includes(code))) throw new Error('Turma fora do curso selecionado');
  const { selectedGroupsByCourse = {} } = await chrome.storage.local.get('selectedGroupsByCourse');
  await chrome.storage.local.set({ selectedGroupsByCourse: { ...selectedGroupsByCourse, [String(course.courseId)]: groups } });
  return { groups };
}

async function waitForRnpTab(tabId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < REQUEST_TIMEOUT_MS) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete" && tab.url?.startsWith(`${ORIGINS.rnp}/rooms/`)) return tab;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("O RNP não concluiu o lançamento em 45 segundos.");
}

async function collectRnpAttendance() {
  const { course, groups } = await getSelectedCourse();
  if (!groups.length) throw new Error('Selecione ao menos uma turma antes da coleta.');
  const rnpActivity = course.activities.find(
    (activity) => activity.type === "lti" && /^RNP$/i.test(activity.name),
  );
  if (!rnpActivity) throw new Error("Atividade RNP não encontrada no curso selecionado.");

  const launchUrl = `${ORIGINS.moodle}/cepm/mod/lti/launch.php?id=${encodeURIComponent(rnpActivity.activityId)}&triggerview=0`;
  const createdTab = await chrome.tabs.create({ url: launchUrl, active: false });
  const rnpTab = await waitForRnpTab(createdTab.id);

  const [{ result: sessions }] = await chrome.scripting.executeScript({
    target: { tabId: rnpTab.id },
    world: "MAIN",
    args: [groups, REQUEST_TIMEOUT_MS],
    func: async (targetGroups, timeoutMs) => {
      async function timedFetch(url, options = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          return await fetch(url, { ...options, signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }
      }

      const initialForm = [...document.forms].find((form) =>
        form.action.includes("set_current_group_on_session"));
      if (!initialForm) throw new Error("Seletor de grupos do RNP não encontrado.");

      const groupMap = Object.fromEntries(
        [...initialForm.querySelectorAll("option")]
          .filter((option) => targetGroups.includes(option.text.trim()))
          .map((option) => [option.text.trim(), option.value]),
      );
      const output = [];

      for (const groupCode of targetGroups) {
        const groupId = groupMap[groupCode];
        if (!groupId) {
          output.push({ groupCode, error: "Grupo não encontrado no RNP", meetings: [] });
          continue;
        }

        const formData = new FormData(initialForm);
        formData.set("group_id", groupId);
        const roomResponse = await timedFetch(initialForm.action, {
          method: "POST",
          credentials: "same-origin",
          body: formData,
        });
        const roomDocument = new DOMParser().parseFromString(await roomResponse.text(), "text/html");
        const historyUrl = [...roomDocument.querySelectorAll("a[href]")]
          .find((link) => /Ver histórico/i.test(link.textContent))?.href;
        if (!historyUrl) {
          output.push({ groupCode, error: "Histórico não encontrado", meetings: [] });
          continue;
        }

        const paginationUrl = new URL(historyUrl);
        paginationUrl.pathname = paginationUrl.pathname.replace(
          /\/meetings$/,
          "/meetings_pagination",
        );
        paginationUrl.searchParams.set("offset", "0");
        paginationUrl.searchParams.set("limit", "1000");
        const historyResponse = await timedFetch(paginationUrl, { credentials: "same-origin" });
        const historyFragment = await historyResponse.text();
        const historyDocument = new DOMParser().parseFromString(
          `<table><tbody>${historyFragment}</tbody></table>`,
          "text/html",
        );
        const meetings = [];

        for (const row of historyDocument.querySelectorAll("table tbody tr")) {
          const cells = [...row.cells].map((cell) => cell.textContent.replace(/\s+/g, " ").trim());
          const artifactEndpoint = row.querySelector("[download-artifacts-endpoint]")
            ?.getAttribute("download-artifacts-endpoint");
          let participantsUrl = null;
          if (artifactEndpoint) {
            const artifactResponse = await timedFetch(
              new URL(artifactEndpoint, historyResponse.url),
              { credentials: "same-origin" },
            );
            const artifactDocument = new DOMParser().parseFromString(
              await artifactResponse.text(),
              "text/html",
            );
            participantsUrl = [...artifactDocument.querySelectorAll("a[href]")]
              .find((link) => link.dataset.trackingId === "lti-download-participants-list")?.href || null;
          }
          meetings.push({
            title: cells[0] || "",
            date: cells[1] || "",
            time: cells[2] || "",
            duration: cells[3] || "",
            participantsUrl,
          });
        }
        output.push({ groupCode, groupId, meetings });
      }
      return output;
    },
  });

  for (const group of sessions) {
    for (const meeting of group.meetings) {
      if (!meeting.participantsUrl) {
        meeting.attendance = [];
        continue;
      }
      const response = await fetchWithTimeout(meeting.participantsUrl);
      if (!response.ok) throw new Error(`Lista RNP respondeu ${response.status}.`);
      const participantsReport = parseRnpParticipants(await response.text());
      meeting.attendance = summarizeRnpAttendance(participantsReport);
      if (participantsReport.metadata.duration) meeting.duration = participantsReport.metadata.duration;
      delete meeting.participantsUrl;
    }
  }

  const collectedAt = new Date().toISOString();
  const rnpReport = { courseId: String(course.courseId), collectedAt, groups: sessions };
  await chrome.storage.local.set({ rnpReport });
  return {
    collectedAt,
    groupCount: sessions.length,
    meetingCount: sessions.reduce((total, group) => total + group.meetings.length, 0),
    attendanceRecordCount: sessions.reduce(
      (total, group) => total + group.meetings.reduce(
        (subtotal, meeting) => subtotal + meeting.attendance.length, 0), 0),
    errorCount: sessions.filter((group) => group.error).length,
  };
}

async function getRnpReport() {
  const { rnpReport, selectedCourseId } = await chrome.storage.local.get([
    "rnpReport", "selectedCourseId",
  ]);
  if (!rnpReport || rnpReport.courseId !== String(selectedCourseId)) return { report: null };
  return { report: rnpReport };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const operation = {
    CONNECT_SOURCES: connectSources,
    CONNECTION_STATUS: connectionStatus,
    DISCOVER_PHILA_COURSES: discoverPhilaCourses,
    DISCOVER_MOODLE_ACTIVITIES: discoverMoodleActivities,
    GET_COURSE_OPTIONS: getCourseOptions,
    SELECT_COURSE: () => selectCourse(message),
    SELECT_GROUPS: () => selectGroups(message),
    GET_SELECTED_COURSE: getSelectedCourse,
    COLLECT_RNP_ATTENDANCE: collectRnpAttendance,
    GET_RNP_REPORT: getRnpReport,
    OPEN_STUDENT_ACTIVITY: async () => {
      const { course, groups } = await getSelectedCourse();
      if (String(course.courseId) !== String(message.courseId) || !groups.includes(message.groupCode)) throw new Error('Curso ou turma fora da seleção atual');
      const activity = course.activities.find(item => String(item.activityId) === String(message.activityId));
      if (!activity) throw new Error('Atividade fora do curso');
      const saved = await chrome.storage.local.get(`moodleReport:${course.courseId}`);
      const results = saved[`moodleReport:${course.courseId}`]?.results || [];
      const jobs = results.filter(job => job.group.code === message.groupCode);
      if (!jobs.some(job => job.records?.some(record => String(record.userId) === String(message.userId)))) throw new Error('Aluno ausente da turma coletada');
      const group = jobs.find(job => job.group.id)?.group;
      if (!group) throw new Error('Realize a coleta da turma primeiro');
      const [tab] = await matchingTabs(ORIGINS.moodle);
      if (!tab) throw new Error('Abra o Moodle autenticado');
      const [execution] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', func: resolveStudentDestination, args: [{ activity, group, userId: message.userId }] });
      const result = execution.result;
      if (!result?.url || new URL(result.url).origin !== ORIGINS.moodle) throw new Error('Destino Moodle não confirmado');
      await chrome.tabs.create({ url: result.url });
      return result;
    },
    READ_MOODLE: async () => {
      const { moodleCatalog } = await chrome.storage.local.get('moodleCatalog');
      const course = moodleCatalog?.courses.find(c => String(c.courseId) === String(message.courseId));
      if (!course) throw new Error('Curso ausente do catálogo');
      const activity = message.activityId ? course.activities.find(a => a.activityId === message.activityId) : null;
      if (message.activityId && !activity) throw new Error('Atividade não pertence ao curso');
      const selected = await getSelectedCourse();
      if (message.group && !selected.groups.includes(message.group.code)) throw new Error('Grupo não selecionado para sincronização');
      const [tab] = await matchingTabs(ORIGINS.moodle);
      if (!tab) throw new Error('Abra o Moodle autenticado');
      if (message.pdf) {
        if (!activity || activity.type !== 'assign' || !message.group || !message.pdf.reportKey?.startsWith(`evaluationExport:${course.courseId}:`)) throw new Error('Escopo PDF inválido');
        const saved = (await chrome.storage.local.get(message.pdf.reportKey))[message.pdf.reportKey];
        if (String(saved?.courseId) !== String(course.courseId)) throw new Error('Curso do relatório PDF divergente');
        const job = saved.jobs.find(j => String(j.activity.activityId) === String(activity.activityId) && j.group.code === message.group.code);
        const row = job?.rows?.find(r => String(r.userId) === String(message.pdf.userId));
        if (!row?.pdf) throw new Error('PDF não identificado na coleta deste aluno');
        const file = message.pdf.kind === 'file' ? row.pdf.files?.find(f => f.url === message.pdf.url) : null;
        if (message.pdf.kind === 'file' ? !file : message.pdf.kind !== 'annotations' || !row.pdf.source) throw new Error('Fonte PDF não confirmada na listagem');
        const [execution] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', func: file ? readPublishedPdf : readPdfAnnotations,
          args: [file ? { url: file.url } : { source: { ...row.pdf.source, courseId: course.courseId } }] });
        const result = execution.result;
        if (result.error || file) return result;
        return normalizePdfAnnotations(result.payload);
      }
      if (message.detailUrl && !activity) throw new Error('Atividade necessária');
      const [execution] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', func: message.detailUrl ? readFeedbackDetail : readMoodle,
        args: [{ courseId: course.courseId, activity, group: message.group, groups: selected.groups, evaluations: message.evaluations === true, url: message.detailUrl }] });
      return execution.result;
    },
  }[message?.type];

  if (!operation) return false;

  operation()
    .then(sendResponse)
    .catch((error) => sendResponse({ error: error.message }));

  return true;
});
