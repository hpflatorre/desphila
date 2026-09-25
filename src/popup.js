const LABELS = {
  phila: "PHILA",
  moodle: "Moodle",
  rnp: "RNP ConferênciaWeb",
};

let courseOptions = [];
let connecting = false;
const countLabel = (count, singular, plural) => `${count} ${count === 1 ? singular : plural}`;

function showCourseDetail(courseId) {
  const detail = document.querySelector("#course-detail");
  const course = courseOptions.find((item) => item.courseId === courseId);
  detail.textContent = course?.discipline || "";
}

async function refresh() {
  const list = document.querySelector("#status-list");
  list.innerHTML = "<li>Verificando…</li>";

  const result = await chrome.runtime.sendMessage({ type: "CONNECTION_STATUS" });
  if (result.error) {
    list.innerHTML = `<li class="missing">${result.error}</li>`;
    return;
  }

  list.replaceChildren(
    ...Object.entries(LABELS).map(([key, label]) => {
      const item = document.createElement("li");
      const state = result[key];
      item.innerHTML = `<span>${label}</span><strong class="${state ? "ok" : "missing"}">${state ? "conectado" : "não aberto"}</strong>`;
      return item;
    }),
  );
}

async function refreshCourses() {
  const select = document.querySelector("#course");
  const result = await chrome.runtime.sendMessage({ type: "GET_COURSE_OPTIONS" });
  if (result.error) return;

  courseOptions = result.courses;
  const repeatedCodes = new Set(
    result.courses
      .map((course) => course.moduleCode)
      .filter((code, index, all) => all.indexOf(code) !== index),
  );

  const placeholder = new Option("Selecione um curso…", "");
  select.replaceChildren(
    placeholder,
    ...result.courses.map((course) => new Option(
      `${course.moduleCode}${repeatedCodes.has(course.moduleCode) ? ` (${course.courseId})` : ""} — ${course.activityCount} ativ. — ${course.discipline}`,
      course.courseId,
    )),
  );
  select.value = result.selectedCourseId;
  showCourseDetail(select.value);
}

async function connect() {
  if (connecting) return;
  connecting = true;
  const button = document.querySelector("#connect");
  const output = document.querySelector("#result");
  button.disabled = true;
  button.textContent = "Conectando…";
  output.classList.add('is-loading');
  output.textContent = "Validando o PHILA e preparando os cursos…";

  try {
    const result = await chrome.runtime.sendMessage({ type: "CONNECT_SOURCES" });
    if (result.error) throw new Error(result.error);
    output.textContent = result.message;
    button.textContent = result.connected ? "Validar novamente" : "Continuar após o login";
    if (result.connected) {
      await refreshCourses();
      output.textContent = `${result.message} Selecione o curso e abra o relatório.`;
    } else {
      output.textContent = `${result.message} Depois do login, clique novamente no ícone da extensão; a validação continuará automaticamente.`;
    }
  } catch (error) {
    output.textContent = error.message;
    button.textContent = "Tentar novamente";
  } finally {
    connecting = false;
    button.disabled = false;
    output.classList.remove('is-loading');
  }
}

async function resumeConnection() {
  const { connectionFlow } = await chrome.storage.local.get('connectionFlow');
  if (!connectionFlow) return;
  const button = document.querySelector('#connect');
  button.textContent = 'Continuar após o login';
  document.querySelector('#result').textContent = connectionFlow.stage === 'moodle'
    ? 'Retomando a conexão com o Moodle…'
    : 'Retomando a conexão com o PHILA…';
  await connect();
}

async function configureDebugTools() {
  const { debugTools = false } = await chrome.storage.local.get("debugTools");
  document.querySelector("#debug-tools").hidden = !debugTools;
  if (debugTools) await refresh();
}

document.querySelector("#connect").addEventListener("click", connect);
document.querySelector("#refresh").addEventListener("click", refresh);
document.querySelector("#discover").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const output = document.querySelector("#result");
  button.disabled = true;
  output.textContent = "Lendo o catálogo de supervisão…";

  try {
    const result = await chrome.runtime.sendMessage({ type: "DISCOVER_PHILA_COURSES" });
    if (result.error) throw new Error(result.error);
    output.textContent = `${countLabel(result.rowCount, 'vínculo encontrado', 'vínculos encontrados')}: ${countLabel(result.groupCount, 'grupo', 'grupos')}, ${countLabel(result.moduleCodeCount, 'código de módulo', 'códigos de módulo')} e ${countLabel(result.courseCount, 'curso Moodle', 'cursos Moodle')}.`;
  } catch (error) {
    output.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
document.querySelector("#discover-moodle").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const output = document.querySelector("#result");
  button.disabled = true;
  output.textContent = "Lendo as atividades dos cursos mapeados…";

  try {
    const result = await chrome.runtime.sendMessage({ type: "DISCOVER_MOODLE_ACTIVITIES" });
    if (result.error) throw new Error(result.error);
    const types = Object.entries(result.counts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([type, count]) => `${type}: ${count}`)
      .join(", ");
    output.textContent = `${countLabel(result.activityCount, 'atividade', 'atividades')} em ${countLabel(result.courseCount, 'curso', 'cursos')} (${types}). ${countLabel(result.failedCourseCount, 'falha', 'falhas')}.`;
    await refreshCourses();
  } catch (error) {
    output.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
document.querySelector("#course").addEventListener("change", async (event) => {
  const output = document.querySelector("#result");
  showCourseDetail(event.target.value);
  if (!event.target.value) {
    output.textContent = "Selecione o curso que será processado.";
    return;
  }

  const result = await chrome.runtime.sendMessage({
    type: "SELECT_COURSE",
    courseId: event.target.value,
  });
  output.textContent = result.error
    ? result.error
    : "Curso selecionado. As próximas coletas ficarão restritas a ele.";
});
document.querySelector("#open-report").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/report.html") });
});
refreshCourses();
configureDebugTools();
resumeConnection();
