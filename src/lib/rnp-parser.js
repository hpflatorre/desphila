const LABELS = Object.freeze({
  title: "Nome da sessão",
  date: "Data",
  time: "Horário",
  duration: "Duração",
  participants: "Participantes",
});

function splitCells(line) {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function parseMetadata(lines) {
  const valueAfterColon = (line) => line?.split(":").slice(1).join(":").trim() || "";

  return {
    title: valueAfterColon(lines[0]),
    dateTime: valueAfterColon(lines[1]),
    duration: valueAfterColon(lines[2]),
  };
}

export function parseRnpParticipants(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw new TypeError("O relatório RNP está vazio.");
  }

  const lines = text.split(/\r?\n/).map((line) => line.trimEnd());
  const tableRows = lines.filter((line) => line.trimStart().startsWith("|"));

  if (tableRows.length < 1) {
    throw new Error("Tabela de participantes não encontrada no relatório RNP.");
  }

  const headers = splitCells(tableRows[0]);
  const participants = tableRows.slice(1).map((line) => {
    const cells = splitCells(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""]));
  });

  return {
    metadata: parseMetadata(lines),
    headers,
    participants,
  };
}

export function summarizeRnpAttendance(report) {
  return report.participants.map((participant) => ({
    name: participant.Nome,
    joinedAt: participant["Horário de entrada"],
    leftAt: participant["Horário de saída"],
    duration: participant["Duração"],
    source: "rnp-participants-list",
  }));
}

export { LABELS };
