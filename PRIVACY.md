# Política de privacidade

Última atualização: 19 de setembro de 2026.

## Finalidade

Esta extensão consolida, para supervisores autorizados, informações de turmas,
atividades, notas, feedbacks e presenças disponíveis no PHILA/Moodle e na
ConferênciaWeb/RNP. Ela funciona no navegador do próprio usuário autenticado.

## Dados acessados

Conforme as permissões da conta autenticada, a extensão pode acessar:

- nomes e identificadores de estudantes;
- situação de entregas e tentativas, notas e feedbacks;
- sessões, horários e duração de presença no RNP;
- nomes e telefones de contatos de turma informados pelo supervisor.

Credenciais, senhas e cookies não são incluídos no código ou nos pacotes de
distribuição. A extensão reutiliza apenas a sessão já autenticada no navegador.

## Armazenamento e processamento

Os dados coletados e as configurações são processados no navegador e armazenados
no `chrome.storage.local` do perfil em que a extensão foi instalada. CSVs e ZIPs
são gerados localmente por solicitação do usuário. Não há servidor próprio,
telemetria, publicidade ou serviço analítico do projeto.

Ao clicar em **Abrir mensagem no WhatsApp**, o número do contato e o texto
pré-preenchido — que pode conter nomes e pendências de estudantes — são enviados
ao WhatsApp por meio de um link `wa.me`. Esse envio só ocorre após ação explícita
do usuário e passa a estar sujeito às políticas e ao tratamento de dados do
WhatsApp. A extensão não aperta o botão final de envio da mensagem.

## Compartilhamento

O projeto não transmite dados ao desenvolvedor. Dados somente saem do navegador
quando o usuário abre o WhatsApp ou salva/compartilha manualmente um relatório.
Supervisores devem conferir destinatários e observar as normas institucionais de
proteção de dados ao manipular esses arquivos e mensagens.

## Retenção e exclusão

Os dados permanecem no perfil local do Chrome até serem substituídos, até o
armazenamento da extensão ser limpo ou até a extensão ser removida. Arquivos
exportados devem ser excluídos separadamente pelo usuário.

## Segurança e escopo

A extensão solicita acesso somente aos domínios usados pelo fluxo PHILA/Moodle,
RNP e ao armazenamento/abas necessários para coleta e abertura dos relatórios.
Ela não contorna permissões dos sistemas: somente dados acessíveis à conta
autenticada podem ser consultados.

Questões de privacidade e segurança podem ser relatadas conforme
[SECURITY.md](SECURITY.md).

