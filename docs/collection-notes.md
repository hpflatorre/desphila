# Coleta acadêmica

## Escopo

Um curso por relatório; grupos PM1_121–PM1_130. Presença síncrona usa apenas
a lista oficial RNP. O código PMMFC042 é duplicado na origem; usar courseId.

## Fontes verificadas

- PHILA: POST `/homepage/procurar-dados-da-homepage`, catálogo da supervisão.
- Moodle: `/cepm/report/progress/index.php?course=…` fornece opções de grupos,
  mesmo com conclusão desativada. IDs de grupo variam por curso.
- Tarefa: `mod/assign/view.php`, action=grading, group explícito, filter=all.
- Questionário: `mod/quiz/report.php`, mode=overview, attempts=enrolled_any,
  onlygraded=0. Ler todas as páginas e considerar múltiplas tentativas.
- Diário: `mod/diary/report.php`, group explícito, tabelas diaryuserentry.
  IDs entry- correspondem aos usuários no seletor jumpuser desta implantação.
- RNP: histórico é carregado por meetings_pagination; o HTML-base é vazio.
  Ler o fragmento dentro de table/tbody. activities.txt contém a presença.

## Armadilhas observadas

- Moodle preenche tabelas até o limite solicitado com linhas vazias; 100 linhas
  HTML podem representar apenas 25 alunos. Identificar links de usuário reais.
- Filtro de status persistido na sessão pode ocultar alunos. Consultar explicitamente
  todos os envios/tentativas e confirmar o grupo retornado.
- Não diagnosticar indisponibilidade após apenas 10 s. Leituras Moodle têm timeout
  de 45 s incluindo corpo e uma repetição. RNP ainda requer melhorias de timeout
  do corpo, repetição, paginação completa e restauração do grupo selecionado.
- Questionário sem questões publicadas não é evidência de pendência do aluno.
- Dados privados ficam apenas no armazenamento local da extensão. Não incluir
  payloads, relatórios nominais, cookies ou links assinados em arquivos de teste.

## Notas e feedbacks: extração

- Tarefa: coluna Nota e comentários de feedback; o link com action
  viewpluginassignfeedback/plugin comments devolve `.feedbackfull`. A lista
  apresenta apenas prévia; falha de detalhe mantém a prévia marcada incompleta.
- Diário: cada textarea c<ID-registro> em table.diaryuserentry identifica o
  feedback do avaliador; select r<ID> traz nota, span.lastedit data da avaliação.
  Não confundir com o corpo do diário escrito pelo aluno. O ID entry- é do aluno.
- Questionário: overview com enrolled_any preserva todas as linhas/tentativas;
  review.php?attempt=...&showall=1 fornece feedback por questão. A nota da questão
  tem escala própria, diferente da nota escalada da atividade.
- Histórico de edição, anexos genéricos e comentários de envio não são
  extraídos nesta versão. Páginas/chat/LTI são pendências explícitas no CSV.
- Os detalhes são lidos individualmente, com persistência após cada resposta,
  para permitir parada e retomada sem uma chamada longa para toda a turma.

### Verificação de 19/09/2026

- Testes locais: 10 passaram (incluindo CSV, tentativas distintas, nota zero,
  feedback incompleto e cobertura de falhas).
- Leitura autenticada PMMFC002: tarefa de amostra com 25 alunos, 22 notas e
  20 links de feedback; um comentário passou de 132 caracteres na prévia para
  376 no detalhe completo. Questionário: 27 linhas, 12 notas/tentativas com
  revisão; revisão de amostra retornou 10 trechos de feedback em 5 questões.
- Diário 1355: coleta pela interface concluiu os 10 grupos, sem falhas,
  177 registros, 126 com nota e feedback. CSV gerado em memória: 172134 bytes,
  UTF-8 com BOM. Não gravamos dados nominais em fixtures ou neste repositório.
- A coleta integral de todos os tipos/atividades do curso ainda não foi executada
  nesta nova ferramenta; as verificações de tarefa e questionário foram amostrais.

## Anotações PDF — implementação e evidências de 19/09/2026

- O índice lê JSON de `M.assignfeedback_editpdf.editor.init`, sem executar
  scripts da página, e associa linkid/usuário à linha da tabela. Exige readonly
  e tentativa identificada; não infere o ID interno da tarefa pelo ID do módulo.
- A leitura usa somente `action=pollconversions&readonly=1`, após confirmação
  da origem em um relatório salvo do curso/turma/aluno. Não usa savepage,
  generatepdf, rotatepage, deletefeedbackdocument ou outros comandos de edição.
  O Moodle pode produzir caches da visualização como na abertura normal do leitor.
- Somente comentários com draft=0 são exportados. Dados de publicação
  desconhecida são erro; rascunhos inesperados são descartados, sem gravar texto.
  Sesskey é obtido transitoriamente e nunca salvo ou incluído no CSV.
- Download restrito a pluginfile.php/.../assignfeedback_editpdf/download/...
  no mesmo Moodle. Links precisam estar no índice salvo; resposta deve começar
  com `%PDF-`. Limites de memória e timeout abrangem a leitura do corpo.
- ZIP local sem compressão, nomes sanitizados, CRC32, recibo de downloads e CSV
  de cobertura. Não inclui arquivos que falharam nem trata download como prova
  de leitura completa das anotações. PDFs não ficam no chrome.storage.local.
- Testes: 17 testes Node passaram; ZIP verificado também pelo zipfile do Python.
  Fixtures de navegador: 27 asserções, sem requisições reais, cobrindo índice DOM,
  JSON com escapes, filtro de rascunhos, origens, limite, HTML/login, retomada e
  criação do ZIP pela interface, com sucesso e falha de download.
- Verificação real: PMMFC002, tarefas 1357/1358, 20 consultas (10 grupos cada),
  nenhuma linha com conteúdo na coluna Anotar PDF. PMMFC001, tarefas 819/825/820,
  30 consultas nos mesmos dez grupos, também sem conteúdo nessa coluna.
  Não abriram o editor de correção. Nova função instalada confirmou 25 estados
  PDF absent no grupo PM1_121/atividade819, com índice concluído sem erro.
- Limite de evidência: nenhum caso positivo real de anotação publicada foi
  encontrado; extração de texto e download autenticado de um PDF anotado real
  ainda não validados. A ausência na listagem não comprova ausência de rascunhos,
  correções em anexos nem conteúdo oculto pelas permissões da sessão.

Referências de estrutura do Moodle usadas para o coletor (a versão exata do
PHILA não foi confirmada):

- https://github.com/moodle/moodle/blob/MOODLE_405_STABLE/mod/assign/feedback/editpdf/classes/renderer.php
- https://github.com/moodle/moodle/blob/MOODLE_405_STABLE/mod/assign/feedback/editpdf/ajax.php
- https://github.com/moodle/moodle/blob/MOODLE_405_STABLE/mod/assign/feedback/editpdf/locallib.php

## Demais limitações abertas

## Seletor de notas e feedbacks — 19/09/2026

- O seletor usa somente assign, quiz e diary, na ordem do catálogo. A primeira
  atividade é o padrão e `all` aparece por último com o rótulo “Curso inteiro
  (todas as atividades avaliáveis)”. A coleta `all` usa exatamente o mesmo
  subconjunto, evitando pendências artificiais de page/talking/LTI.
- “Clique aqui para acessar o curso” era uma atividade externa/LTI de navegação,
  não uma fonte de nota ou feedback; foi removida desse seletor, mas permanece
  intacta no catálogo interno usado por outras funções.

## Falhas de coleta e atenção RNP — 19/09/2026

- Repetir pendências fica oculto sem relatório e quando todas as consultas são
  completas/sem erro. `retryCount = total - resultados completos sem erro`;
  portanto inclui consultas não executadas após parada e respostas com falha.
  A mensagem de status diferencia essa pendência técnica de entrega de aluno.
- Referência RNP: cada amostra é a soma das durações HH:MM:SS de um nome
  normalizado dentro de uma sessão (reconexões somadas). A média abrange os dez
  grupos disponíveis no relatório do curso. Valores não interpretáveis não
  entram na amostra. Homônimos dentro da turma não são classificados.
- Corte configurável por curso em `moodleRnpAttentionPercent:<courseId>`, padrão
  50. O limiar é `média * (1 - percentual/100)` e somente valores estritamente
  menores são sinalizados. Amarelo representa atenção RNP; vermelho permanece
  reservado à entrega explicitamente pendente.
- Verificação real no relatório salvo: 90/110 consultas válidas fizeram o botão
  aparecer com 20 pendências/falhas; média RNP 98 min, limiar 49 min, 172
  presenças válidas e 7 células/linhas amarelas. Nenhuma coleta ou mensagem foi
  disparada nessa verificação. Regressão: 24 testes passaram.

### Ação contextual e filtro RNP

- O botão fixo Repetir pendências foi removido. Quando retryCount > 0, `render`
  cria um button semântico com aparência de link dentro do status; o clique chama
  o mesmo `collect({retry:true})`. Sem falhas, o link não existe no DOM.
- `moodleRnpAttentionEnabled:<courseId>` controla a presença curta, com padrão
  true quando ausente. Desmarcar remove essas pessoas do filtro, o amarelo e a
  mensagem WhatsApp, mas não apaga nem altera os registros RNP. O limiar fica
  desabilitado visualmente até a opção ser reativada.

## Enxugamento da interface e idade dos dados — 19/09/2026

- Os controles de atividades e RNP foram reunidos no mesmo bloco. A tabela
  estática do inventário, cujo “Aguardando coleta” não refletia os coletores,
  foi removida. A relação das turmas e a auditoria RNP estão em details fechado
  no final da página.
- Status de atividades, RNP e notas/feedbacks recebem spinner via classe
  `is-loading`, removida em finally inclusive após erro. Movimento reduzido do
  sistema desacelera a animação.
- A idade usa o item completo e sem erro mais antigo ainda presente. Novas
  consultas gravam `queriedAt`; dados antigos usam `collectedAt`. Isso evita que
  repetir somente falhas rejuvenesça artificialmente resultados preservados.
- A duração RNP soma os registros HH:MM:SS do aluno em todas as sessões em que
  seu nome completo foi localizado, arredondando o total para minutos. Formato
  ausente ou desconhecido aparece como duração indisponível.
- Verificação real com dados já salvos: controles no mesmo bloco, tabela antiga
  ausente, auditoria fechada e no fim; indicadores exibiram idades distintas
  para atividades e RNP; presença apareceu no formato `N sessão(ões) (X minutos)`.
  Nenhuma nova coleta foi disparada. Regressão: 23 testes passaram.

## Análise de pendências e WhatsApp — 19/09/2026

- A seleção é múltipla e persistida por curso em
  `moodlePendingSelection:<courseId>`. O teste ao vivo foi limpo ao final, sem
  deixar uma atividade arbitrariamente marcada para o usuário.
- Pendência explícita: assign not_submitted/draft e quiz
  not_started/in_progress. Estados submitted/finished/recorded são positivos.
  Estado unknown, ausência de registro (inclusive diário) e consulta incompleta
  ficam como conferência, sem afirmar falta na mensagem.
- Os contatos ficam localmente em `moodleWhatsAppContacts`, por código da turma,
  com nome opcional e telefone. O número precisa ter 10 a 15 dígitos após remover
  pontuação; recomenda-se DDI+DDD. Nenhum contato foi gravado em código/fixture.
- A abertura usa `https://web.whatsapp.com/send?phone=...&text=...` em nova aba
  somente após clique. A extensão não envia a mensagem. URLs acima de 8.000
  caracteres são recusadas para evitar abertura truncada.
- A mensagem termina com a data/hora registrada pelo relatório. A coleta agora
  atualiza `updatedAt` após cada consulta e ao encerrar; relatórios antigos usam
  `collectedAt` como compatibilidade.
- Verificação: 20 testes Node passaram. No PMMFC002 salvo, a interface exibiu
  11 atividades, 10 turmas e, com uma atividade temporariamente marcada,
  destacou 39 alunos/células. Número inválido foi bloqueado. A seleção de teste
  foi removida e nenhuma aba do WhatsApp foi aberta.

### Ajustes de abertura e filtragem

- O destino foi alterado de web.whatsapp.com para o link universal oficial
  `https://wa.me/<numero>?text=<mensagem>`. Ele permite continuar no aplicativo
  disponível ou no WhatsApp Web; a decisão final pertence ao navegador/sistema.
- `moodlePendingOnly:<courseId>` guarda o filtro das listagens. Ausência da chave
  equivale a true; portanto, ele nasce marcado. O filtro só se aplica com ao
  menos uma atividade selecionada, mantendo a relação completa antes da análise.
- Verificação ao vivo no PMMFC002: com o filtro marcado, 41 linhas visíveis e
  41 destacadas para a seleção que permaneceu salva. A atividade adicionada
  apenas para o teste foi removida, preservando a seleção preexistente 1352.

### Fechamento da exportação (19/09/2026)

- Por orientação do usuário, a validação positiva de PDF real fica adiada até
  que um supervisor disponibilize uma anotação; não bloqueia notas/feedbacks.
  A interface sinaliza essa distinção explicitamente.
- Nova coleta preserva o relatório anterior em memória e no armazenamento se
  falhar a descoberta das turmas, se o mapeamento vier incompleto ou se falhar
  o primeiro salvamento do novo retrato. Após esse salvamento, a substituição
  confirmada segue normalmente; isso não cria histórico permanente de versões.
- Progresso mostra turma/atividade durante leituras demoradas.
- Regressão: 17 testes locais e 37 asserções de navegador com dados sintéticos.
  Inclui coleta por atividade/curso, isolamento entre seus retratos, parada,
  retomada sem repetir índices concluídos e três falhas de início de nova coleta.
- Quando existir anotação publicada: conferir texto/página com a tela Moodle,
  confirmar exclusão de rascunhos e abrir o PDF efetivamente baixado do ZIP.
  Essa prova real continua pendente, não substituída pelos testes sintéticos.

- Conferência independente de matrícula e ausentes RNP ainda não implementadas.
- Ausência de diário não é classificada automaticamente como não realizado.
- Chat, páginas e outros LTI constam do inventário, sem inferência individual.
- RNP agrega registros por sessão; o total não corresponde a alunos únicos.
- A coleta Moodle depende de manter a aba de relatório aberta; resultados são
  salvos após cada consulta. O botão Repetir pendências retoma ausentes e falhas.
