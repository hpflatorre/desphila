import test from "node:test";
import assert from "node:assert/strict";
import { parseRnpParticipants, summarizeRnpAttendance } from "../src/lib/rnp-parser.js";

const fixture = `Nome da sessão: Encontro PM1_121
Data: 18/08/2026 18:43:00
Duração: 02:43:00
Apresentador:
Pessoa Exemplo
Participantes:
+----------------+-----------+-------+---------------------+----------------+---------------+--------------------+------------------+----------+
| Nome           | Bate-papo | Falas | Resposta a enquetes | Levantar a mão | Tempo falando | Horário de entrada | Horário de saída | Duração  |
+----------------+-----------+-------+---------------------+----------------+---------------+--------------------+------------------+----------+
| Aluna Exemplo  | 2         | 1     | 0                   | 0              | 00:01:00      | 18:45:00           | 20:15:00         | 01:30:00 |
| Aluno Exemplo  | 0         | 0     | 1                   | 0              | 00:00:00      | 18:50:00           | 20:10:00         | 01:20:00 |
+----------------+-----------+-------+---------------------+----------------+---------------+--------------------+------------------+----------+
`;

test("interpreta a tabela de participantes do RNP", () => {
  const report = parseRnpParticipants(fixture);

  assert.equal(report.metadata.title, "Encontro PM1_121");
  assert.equal(report.participants.length, 2);
  assert.equal(report.participants[0].Nome, "Aluna Exemplo");
  assert.equal(report.participants[1].Duração, "01:20:00");
});

test("reduz o relatório aos campos usados como prova de presença", () => {
  const attendance = summarizeRnpAttendance(parseRnpParticipants(fixture));

  assert.deepEqual(attendance[0], {
    name: "Aluna Exemplo",
    joinedAt: "18:45:00",
    leftAt: "20:15:00",
    duration: "01:30:00",
    source: "rnp-participants-list",
  });
});

test("rejeita um relatório sem tabela", () => {
  assert.throws(() => parseRnpParticipants("relatório inválido"), /Tabela/);
});
