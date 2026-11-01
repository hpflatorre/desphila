// Maps the PHILA homepage payload (/homepage/procurar-dados-da-homepage) to the turmas the user follows.
// Supervisors get `homepageSupervisor.gruposDeTurma`; facilitators (tutores a distância) get
// `homepageTAD.gruposDeTurmaAbertas`. A user with both roles gets the union.

const GROUP_NAME = /^(PMMFC\d+).*\/\s*([A-Z][A-Z0-9_-]+)\b/i;

function groupRow({ role, groupRecordId, philaClassId, name, discipline, link }, moodleOrigin) {
  const match = name?.match(GROUP_NAME);
  if (!match || !link) return null;
  let moodle;
  try {
    moodle = new URL(link);
  } catch {
    return null;
  }
  // Tutor training turmas live on another Moodle; only the course Moodle is collected.
  if (moodle.origin !== moodleOrigin || !moodle.searchParams.get("id")) return null;
  return {
    role,
    groupRecordId,
    philaClassId,
    moduleCode: match[1],
    groupCode: match[2],
    className: name,
    discipline,
    moodleUrl: moodle.href,
    moodleCourseId: moodle.searchParams.get("id"),
  };
}

export function philaGroupRows(data, moodleOrigin) {
  const supervised = data?.homepageSupervisor?.gruposDeTurma;
  const facilitated = data?.homepageTAD?.gruposDeTurmaAbertas;
  if (!Array.isArray(supervised) && !Array.isArray(facilitated)) {
    throw new Error("Nenhuma turma de supervisão ou facilitação foi encontrada no PHILA.");
  }
  const rows = [
    ...(supervised || []).map((row) => groupRow({
      role: "supervisor", groupRecordId: row.id, philaClassId: row.idTurma,
      name: row.nome, discipline: row.disciplina, link: row.linkMoodle,
    }, moodleOrigin)),
    ...(facilitated || []).map((row) => groupRow({
      role: "facilitador", groupRecordId: row.idGrupo, philaClassId: row.idTurma,
      name: row.nomeGrupo, discipline: row.nomeDisciplina, link: row.linkMoodle,
    }, moodleOrigin)),
  ].filter(Boolean);
  // The same turma can appear in both lists; keep the supervisor entry, which comes first.
  const unique = new Map();
  for (const row of rows) {
    const key = `${row.moodleCourseId}:${row.groupCode}`;
    if (!unique.has(key)) unique.set(key, row);
  }
  return [...unique.values()];
}
