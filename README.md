# Relatórios PHILA

Extensão Chrome Manifest V3 para consolidar atividades das turmas selecionadas
pelo operador no PHILA, Moodle e ConferênciaWeb/RNP.

Projeto independente e não oficial, disponibilizado para auditoria técnica. Não
é mantido nem endossado pela UFMG, Nescon, Moodle, RNP ou WhatsApp. Consulte
[PRIVACY.md](PRIVACY.md) antes de usar dados reais e [INSTALLATION.md](INSTALLATION.md)
para instalar uma versão empacotada.

O código é distribuído sob a [licença MIT](LICENSE). Solicitações de recursos e
notificações de bugs devem ser abertas nas issues ou discussões do repositório.

As turmas são escolhidas por curso e a seleção fica armazenada no navegador.
Os dados não são atualizados automaticamente: o operador precisa iniciar cada
coleta manualmente. Nenhuma coleta é habilitada sem ao menos uma turma marcada.

## Estado atual

- manifesto e permissões mínimas dos três sistemas;
- verificação de sessões abertas;
- configuração dos dez grupos;
- descoberta e armazenamento local do catálogo PHILA;
- inventário das atividades avaliáveis nos cursos Moodle;
- seleção persistente de um curso por execução do relatório;
- tela consolidada com atividades e grupos do curso selecionado;
- coleta sequencial das listas oficiais de presença do RNP, com timeout de 45 s;
- parser local do artefato `activities.txt` do RNP e do relatório de engajamento
  de cada sessão (tempo online, fala, câmera, chat, mãos levantadas, reações,
  enquetes e pontuação de atividade), exportável em CSV;
- matriz por aluno/grupo para tarefas, questionários, registros do diário e edições em wikis colaborativas;
- coleta Moodle sequencial, limite de 45 s incluindo leitura do corpo e uma repetição;
- salvamento por curso a cada consulta, parada após consulta atual e exportação CSV;
- nenhuma credencial ou informação real de aluno armazenada no código.

## Uso

Mapeie turmas e atividades, selecione um curso e abra o relatório. Use **Coletar
atividades** para preencher a matriz dos dez grupos. Mantenha a aba do relatório
aberta durante a coleta. O botão de parada preserva as consultas já concluídas.
Os resultados ficam em `chrome.storage.local`, neste perfil do Chrome.
**Repetir pendências** preserva consultas bem-sucedidas e executa apenas as
ausentes ou com falha.

As linhas vazias adicionadas pelo Moodle não contam como alunos. Questionários
usam inscritos com e sem tentativa e preservam tentativas finalizadas quando há
mais de uma. Ausência de registro no diário fica como **Sem evidência**. A lista
de alunos vem dos relatórios de atividades; a conferência independente de matrícula
e o cruzamento de ausentes RNP ainda estão pendentes. Recuperações e reofertas
não são automaticamente consideradas obrigatórias para todos. Wikis colaborativas
contam as edições no histórico da wiki da turma; edições da equipe não criam alunos.
Cada coleta atualiza a lista de atividades do curso. As atividades aparecem como
“Tipo: título” (Tarefa, Wiki, Questionário, Diário); tarefas e wikis usam o título
em destaque na primeira linha da descrição e, sem ele, o nome da atividade no Moodle. Páginas, chat e
outros LTI permanecem no inventário, sem conclusão individual inferida.

A matriz cruza presenças RNP primeiro pelo ID Moodle que o relatório de engajamento
registra para quem entrou pelo Moodle; convidados e sessões sem engajamento usam o
nome completo normalizado, e homônimos sem ID ficam como “Nome ambíguo”. Convidados
que digitam nome abreviado (“Ana Souza”) são aceitos quando o primeiro nome coincide,
todas as demais palavras constam do nome completo e o nome serve a um único aluno da
turma; a matriz indica “nome parcial” nessas presenças para conferência.
“Não localizado no RNP” é classificado como pendência, inclusive para chamar
atenção a possíveis diferenças de cadastro ou ao subgrupo A/B. Abra cada grupo
na seção RNP para auditar as sessões, participantes e horários.

## Pendências e WhatsApp

Depois da coleta de atividades, marque as atividades que já deveriam ter sido
concluídas no quadro **Atividades consideradas na análise de pendências**. A
seleção é múltipla e fica salva por curso. A tabela destaca alunos e células
com os estados explícitos **Sem envio**, **Rascunho**, **Sem tentativa** ou
**Em progresso**. “Sem evidência”, ausência de diário e falha de consulta não
são transformadas em falta; a mensagem informa que há itens para conferência.
Por padrão, as listagens mostram somente alunos com pendências depois que pelo
menos uma atividade é selecionada. Essa opção pode ser desmarcada e fica salva
por curso; sem atividades selecionadas, todos os alunos continuam visíveis.

Cada turma possui campos locais para nome do contato e telefone com DDI/DDD. O
contato é reaproveitado nos demais cursos da mesma turma. O botão **Abrir mensagem
no WhatsApp** usa o link universal oficial `wa.me`, permitindo continuar no
aplicativo instalado ou no navegador. A extensão não envia a mensagem: o
supervisor deve conferir e confirmar o envio. A mensagem contém curso, turma,
alunos, atividades e situações pendentes; a última linha registra a data e hora
da atualização dos dados. Números inválidos são bloqueados. Mensagens acima de
8.000 caracteres são copiadas para a área de transferência e a conversa é aberta
sem texto para colagem manual. Os nomes dos alunos na mensagem mantêm o primeiro e o último
nome, abreviando os nomes intermediários para manter o texto compacto. Os contatos e as seleções ficam apenas no armazenamento local
do perfil da extensão.

## Interface e atualização dos dados

As coletas de atividades e RNP ficam no mesmo bloco. Durante uma consulta, um
indicador animado aparece no início da respectiva linha de status. Cada bloco
mostra também a idade do dado bem-sucedido mais antigo ainda usado naquele
relatório; ao repetir somente pendências, resultados antigos preservam sua idade.

A coluna de presença da matriz apresenta o total acumulado em duas linhas:
`1 presença`/`N presenças` e `X minutos (Y% da sessão/das sessões)`.
O cabeçalho lista a duração total de cada encontro e o título da turma mostra
o percentual médio do tempo de participação de seus alunos. O cabeçalho RNP
separa o percentual de alunos com presença localizada do percentual médio do
tempo permanecido. Cada atividade também mostra o percentual de alunos com
conclusão ou envio registrado. Durações ausentes são declaradas
como indisponíveis, não como zero. A antiga tabela estática de atividades foi
removida porque não refletia o estado das coletas. O detalhamento por sessão do
RNP e a relação das turmas ficam recolhidos em **Verificação: sessões e registros
de presença RNP**, no final do relatório.

O botão **Repetir pendências** aparece somente quando a coleta de atividades
tem consultas incompletas, interrompidas ou com falha. Ele não representa alunos
com entrega atrasada: repete apenas as consultas técnicas que não produziram um
resultado válido. A ação aparece como link clicável dentro da própria linha de
status e não ocupa permanentemente a barra de controles.

Questionários que retornem **sem questões publicadas** em todas as turmas são
classificados como atividades não utilizadas: ficam identificados no relatório,
mas são omitidos da matriz, da exportação e da repetição de pendências. Qualquer
outro tipo de falha continua visível e repetível para não esconder erros reais.

Cada atividade pode ser marcada separadamente como **Verificar feedback**. Uma nova
coleta passa então a verificar comentários, detalhes de feedback e PDFs publicados.
Entregas concluídas sem devolutiva localizada aparecem em uma tabela própria por
turma. Leituras incompletas permanecem como cobertura pendente e não são tratadas
como ausência de feedback. Quando o Moodle fornece a data de envio, a tabela e
as exportações mostram quantos ciclos completos de 24 horas transcorreram; datas
indisponíveis não são estimadas.

Ao clicar nos estados da matriz ou em um feedback pendente, a extensão consulta
o Moodle naquele momento e procura a avaliação da tarefa, a tentativa do
questionário ou o registro do diário do aluno. Se não localizar um destino
individual, abre a listagem da turma e informa esse resultado. A busca de destinos
não é executada durante a sincronização. A coleta de feedback continua consultando
os detalhes necessários para verificar as devolutivas.

Em cada turma, o mesmo retrato preparado para o WhatsApp pode ser exportado como
tabela CSV, imagem PNG ou mensagem TXT. Todos os formatos incluem a data de
atualização e separam claramente dois blocos: **Pendências do aluno** (entregas
não realizadas e alertas RNP) e **Pendências do facilitador — feedback**.

Presenças curtas são pontos de atenção, não faltas. A extensão soma reconexões
da mesma pessoa em cada sessão e calcula, dentro de cada turma, o tempo total de
participação dividido pela duração total dos encontros dos quais ela participou.
Por padrão, destaca em amarelo percentuais abaixo de 50%. O limiar pode ser
alterado de 0% a 100% no quadro de análise. Alunos nessa condição entram no
filtro de pendências/pontos de atenção e na mensagem do WhatsApp com a
participação agregada e o limiar utilizados. O checkbox **Incluir presenças curtas na
análise, no filtro e na mensagem do WhatsApp** permite desligar completamente
essa classificação, preservando a coleta RNP e sua duração normal na tabela.

## Notas e feedbacks

No relatório, use a seção **Notas e feedbacks**. Selecione **Curso inteiro** ou
uma atividade e clique em **Coletar / retomar pendências**. O CSV usa UTF-8 com
BOM, separador ponto e vírgula e aceita comentários com quebras de linha no
Excel/LibreOffice. Cada feedback de questão ganha sua própria linha, preservando
IDs de aluno, atividade e tentativa. As notas da atividade se repetem nessas
linhas: não as some para obter a nota do aluno.

O seletor abre na primeira atividade avaliável e apresenta **Curso inteiro**
como última opção. Ele contém somente tarefas, questionários e diários. Páginas,
chats e links LTI — inclusive links com nomes como “Clique aqui para acessar o
curso” — são navegação externa do Moodle e não possuem notas ou feedbacks para
este coletor, por isso ficam fora da lista. **Curso inteiro** significa todas as
atividades avaliáveis suportadas, não todos os links do inventário.

A coleta lê avaliações atuais das tarefas, feedbacks de registros de diário e
tentativas acessíveis dos questionários. Busca o texto completo da tarefa,
pois a listagem pode truncá-lo. Não inclui histórico de alterações de nota,
anexos genéricos nem comentários de envio fora do campo de feedback de avaliação.
Anotações PDF publicadas pelo recurso Anotar PDF são tratadas conforme abaixo.
Tipos ainda não suportados e consultas com falha são
explicitamente registrados no CSV; dados vazios nunca viram nota zero.

Use **Nova coleta atualizada** para um novo retrato. Exporte antes caso queira
preservar o anterior. Interromper ou fechar a aba mantém as consultas já salvas;
retome no mesmo curso e atividade. Leituras de detalhes têm limite de 45 segundos
e podem ser repetidas pelo botão de retomada. Os dados ficam no perfil local do
Chrome; o CSV contém dados pessoais e deve ser guardado e compartilhado com cuidado.

### Anotações PDF e pacote ZIP

A coleta procura PDFs publicados na coluna **Anotar PDF** das tarefas. Lê somente
o visualizador de leitura, sem abrir o editor, salvar avaliações, publicar
rascunhos ou solicitar a geração de um novo PDF. Comentários digitados ficam
na planilha com página (iniciando em 1), ID da anotação e posição. Marcações
visuais são listadas pelo tipo; o contexto deve ser conferido no PDF original
anotado. Não há OCR nem interpretação automática de desenhos.

**Baixar planilha + PDFs (ZIP)** fica disponível quando a coleta identifica
arquivos publicados. O pacote contém:

- `notas-feedbacks.csv`, com notas, comentários, cobertura e caminhos relativos;
- PDFs em pastas de curso/turma/atividade, identificados por ID do aluno e tentativa;
- `arquivos.csv`, com resultado de cada download, inclusive falhas;
- `LEIA-ME.txt`, com limitações e orientações.

Extraia o ZIP antes de acessar os PDFs. Um pacote parcial não significa que
todas as anotações foram exportadas: confira ambos os CSVs. O botão de parada
interrompe após a consulta atual e produz um pacote parcial. Downloads podem
ser tentados novamente, mas seus bytes não são persistidos entre execuções.
Limites: 20 MiB por PDF e 100 MiB de PDFs por pacote, para limitar o uso de
memória. Acima disso, selecione uma atividade menor ou baixe arquivos individuais
pelo Moodle. Respostas HTML/login nunca são incluídas como se fossem PDF.

Coletas antigas de tarefas são atualizadas ao retomar, para consultar a coluna
PDF. Campo vazio significa apenas que nenhuma anotação publicada foi exposta
na listagem. Rascunhos não são consultados, e formatos desconhecidos ficam
pendentes. Correções em arquivos anexados fora do plugin Anotar PDF não estão
incluídas. A implementação foi testada com fixtures; ainda falta um PDF
anotado publicado visível na sessão real para validação positiva de ponta a ponta.

## Testes automatizados

```bash
npm test
```

O teste de interoperabilidade ZIP usa `python3`/`zipfile` apenas com dados
sintéticos em memória. Com o Chrome de diagnóstico em `127.0.0.1:9222` e uma aba
da extensão aberta, execute também `npm run test:browser-pdf`. Esse teste usa
DOM nativo, transporte simulado e armazenamento em memória: não consulta o
Moodle, não baixa arquivos nem altera os relatórios reais.

## Carregar no Chrome

Abra `chrome://extensions`, ative **Modo do desenvolvedor**, escolha
**Carregar sem compactação** e selecione esta pasta.
