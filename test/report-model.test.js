import test from 'node:test';
import assert from 'node:assert/strict';
import {groupMatrix,csvCell,attendanceForStudent,pendingAnalysis,normalizeWhatsAppPhone,buildPendingMessage,buildWhatsAppUrl,rnpAttentionAnalysis,durationSeconds,unusedActivities,activityCompletion,feedbackPendingAnalysis,pendingExportRows,fullDaysSince,waitingDaysLabel} from '../src/lib/report-model.js';
test('mantém finalização entre múltiplas tentativas e separa homônimos por ID',()=>{
  const report={results:[{group:{code:'PM1_121'},activityId:'1',records:[
    {userId:'10',name:'Pessoa',status:'finished'}, {userId:'10',name:'Pessoa',status:'in_progress'},
    {userId:'11',name:'Pessoa',status:'not_started'},
  ]},{group:{code:'PM1_122'},activityId:'1',records:[{userId:'12',status:'finished'}]}]};
  const rows=groupMatrix(report,'PM1_121');assert.equal(rows.length,2);
  assert.equal(rows.find(r=>r.userId==='10').states['1'].status,'finished');
  assert.equal(rows.find(r=>r.userId==='11').states['1'].status,'not_started');
  assert.equal(rows[0].states['missing'],undefined);
});
test('CSV neutraliza fórmulas e preserva aspas',()=>{
  assert.equal(csvCell('=1+1'),'"\'=1+1"');assert.equal(csvCell('a"b'),'"a""b"');
});
test('RNP calcula participação agregada sem confundir homônimos ou declarar falta',()=>{
  const student={name:'João Exemplo'};
  const rnp={groups:[{groupCode:'PM1_121',meetings:[{duration:'02:00:00',attendance:[{name:'JOAO EXEMPLO',duration:'01:30:00'}]},{duration:'01:00:00',attendance:[{name:'João Exemplo',duration:'00:18:00'}]}]}]};
  assert.equal(attendanceForStudent(rnp,'PM1_121',student,[student]),'2 presenças\n108 minutos (60% das sessões)');
  const single={groups:[{groupCode:'PM1_121',meetings:[{duration:'01:08:30',attendance:[{name:'João Exemplo',duration:'00:54:00'}]}]}]};
  assert.equal(attendanceForStudent(single,'PM1_121',student,[student]),'1 presença\n54 minutos (79% da sessão)');
  assert.equal(attendanceForStudent(rnp,'PM1_121',student,[student,{name:'João Exemplo'}]),'Nome ambíguo');
  const other={name:'Outra Pessoa'};
  assert.equal(attendanceForStudent(rnp,'PM1_121',other,[other]),'Não localizado no RNP');
  assert.equal(attendanceForStudent(rnp,'PM1_122',student,[student]),'Sem evidência RNP');
});
test('presença registrada mantém sessão quando a duração está indisponível',()=>{
  const student={name:'Pessoa'};
  const rnp={groups:[{groupCode:'PM1_121',meetings:[{attendance:[{name:'Pessoa',duration:''}]}]}]};
  assert.equal(attendanceForStudent(rnp,'PM1_121',student,[student]),'1 presença\nduração indisponível');
});
test('presenças curtas usam percentual agregado por turma e somam reconexões',()=>{
  const students=[{userId:'1',name:'Ana'},{userId:'2',name:'Bia'}];
  const rnp={groups:[
    {groupCode:'PM1_121',meetings:[
      {title:'Sessão 1',date:'01/09',duration:'01:00:00',attendance:[{name:'Ana',duration:'00:10:00'},{name:'Ana',duration:'00:05:00'},{name:'Bia',duration:'01:00:00'}]},
      {title:'Sessão 2',date:'02/09',duration:'01:00:00',attendance:[{name:'Ana',duration:'00:20:00'},{name:'Bia',duration:'01:00:00'}]},
    ]},
    {groupCode:'PM1_122',meetings:[{title:'Sessão 3',attendance:[{name:'Outra',duration:'01:00:00'}]}]},
  ]};
  const result=rnpAttentionAnalysis(rnp,'PM1_121',students,85);
  assert.equal(result.sampleCount,2);assert.equal(result.averagePercent,65);assert.equal(result.cutoffPercent,85);
  assert.equal(result.participationCount,2);assert.equal(result.participationPercent,100);
  assert.deepEqual(result.sessionDurations.map(item=>item.minutes),[60,60]);
  assert.deepEqual(result.students.map(s=>[s.name,s.percent,s.totalMinutes,s.totalSessionMinutes]),[['Ana',29,35,120]]);
  assert.equal(durationSeconds('01:02:03'),3723);assert.equal(durationSeconds('01:70:00'),null);
  assert.equal(durationSeconds('2h 43min'),9780);assert.equal(durationSeconds('2 horas 43 minutos'),9780);assert.equal(durationSeconds('02:43'),9780);
});
test('RNP classifica aluno não localizado como pendência sem confundir indisponibilidade',()=>{
  const students=[{userId:'1',name:'Ana'},{userId:'2',name:'Bia'}];
  const rnp={groups:[{groupCode:'PM1_121',meetings:[{duration:'01:00:00',attendance:[{name:'Ana',duration:'01:00:00'}]}]}]};
  const result=rnpAttentionAnalysis(rnp,'PM1_121',students,50);
  assert.equal(result.available,true);
  assert.deepEqual(result.students.map(student=>[student.name,student.status]),[['Bia','not_found']]);
  assert.deepEqual(rnpAttentionAnalysis(rnp,'PM1_122',students,50).students,[]);
});
test('RNP localiza pelo ID Moodle do engajamento antes do nome e resolve homônimos',()=>{
  const students=[{userId:'1',name:'Ana Souza'},{userId:'2',name:'Ana Souza'},{userId:'3',name:'Bia Lima'}];
  const rnp={groups:[{groupCode:'PM1_121',meetings:[{duration:'01:00:00',
    attendance:[{name:'Ana S.',duration:'00:40:00'},{name:'Ana Souza',duration:'00:30:00'},{name:'Bia Lima',duration:'01:00:00'}],
    engagement:{participants:[{name:'Ana S.',moodleUserId:'1'},{name:'Ana Souza',moodleUserId:''}]}}]}]};
  assert.equal(attendanceForStudent(rnp,'PM1_121',students[0],students),'1 presença\n40 minutos (67% da sessão)');
  assert.equal(attendanceForStudent(rnp,'PM1_121',students[1],students),'Nome ambíguo');
  assert.equal(attendanceForStudent(rnp,'PM1_121',students[2],students),'1 presença\n60 minutos (100% da sessão)');
});
test('RNP aceita nome parcial de convidado apenas quando identifica um único aluno',()=>{
  const students=[{userId:'1',name:'Ana Maria Souza Lima'},{userId:'2',name:'Bia Costa Ramos'},{userId:'3',name:'Bia Ramos Neves'},{userId:'4',name:'Caio de Paula'}];
  const rnp={groups:[{groupCode:'PM1_121',meetings:[{duration:'01:00:00',attendance:[
    {name:'ana souza',duration:'00:30:00'},{name:'Bia Ramos',duration:'01:00:00'},{name:'Caio',duration:'01:00:00'},{name:'Ana Lima Prado',duration:'01:00:00'},
  ]}]}]};
  assert.equal(attendanceForStudent(rnp,'PM1_121',students[0],students),'1 presença\n30 minutos (50% da sessão)\nnome parcial em 1 sessão');
  assert.equal(attendanceForStudent(rnp,'PM1_121',students[1],students),'Não localizado no RNP'); // "Bia Ramos" fits two students
  assert.equal(attendanceForStudent(rnp,'PM1_121',students[3],students),'Não localizado no RNP'); // first name alone is not enough
});
test('percentual de finalização usa os alunos da turma como denominador',()=>{
  const students=[{states:{'1':{status:'submitted'}}},{states:{'1':{status:'finished'}}},{states:{'1':{status:'not_started'}}},{states:{}}];
  assert.deepEqual(activityCompletion(students,'1'),{completed:2,total:4,percent:50});
});
test('omite somente atividade sem questões em todas as turmas',()=>{
  const activities=[{activityId:'1',name:'Quiz vazio'},{activityId:'2',name:'Falha real'}];
  const report={results:[
    {group:{code:'A'},activityId:'1',complete:false,error:'Questionário sem questões publicadas'},
    {group:{code:'B'},activityId:'1',complete:false,error:'Questionário sem questões publicadas'},
    {group:{code:'A'},activityId:'2',complete:false,error:'HTTP 500'},
    {group:{code:'B'},activityId:'2',complete:false,error:'HTTP 500'},
  ]};
  assert.deepEqual(unusedActivities(report,activities,['A','B']).map(item=>item.activityId),['1']);
});
test('análise de pendências usa apenas estados negativos explícitos',()=>{
  const activities=[{activityId:'1',name:'Tarefa A'},{activityId:'2',name:'Questionário B'},{activityId:'3',name:'Diário C'}];
  const report={results:[
    {complete:true,group:{code:'PM1_121'},activityId:'1',records:[{userId:'10',name:'Ana',status:'not_submitted'},{userId:'11',name:'Bia',status:'submitted'}]},
    {complete:true,group:{code:'PM1_121'},activityId:'2',records:[{userId:'10',name:'Ana',status:'finished'},{userId:'11',name:'Bia',status:'in_progress'}]},
    {complete:true,group:{code:'PM1_121'},activityId:'3',records:[{userId:'10',name:'Ana',status:'recorded'}]},
  ]};
  const result=pendingAnalysis(report,'PM1_121',activities);
  assert.deepEqual(result.pending.map(s=>[s.name,...s.missing.map(x=>x.activity.name)]),[['Ana','Tarefa A'],['Bia','Questionário B']]);
  assert.equal(result.unresolved,1); // Diário ausente para Bia não vira falta confirmada.
  assert.equal(result.failedActivities.length,0);
});
test('diário coletado classifica ausência de registro como entrega pendente',()=>{
  const activities=[{activityId:'1',name:'Tarefa',type:'assign'},{activityId:'3',name:'Portfólio Reflexivo Avaliativo',type:'diary'}];
  const report={results:[
    {complete:true,group:{code:'PM1_121'},activityId:'1',records:[{userId:'10',name:'Ana',status:'submitted'},{userId:'11',name:'Bia',status:'submitted'}]},
    {complete:true,group:{code:'PM1_121'},activityId:'3',records:[{userId:'10',name:'Ana',status:'recorded'}]},
  ]};
  const result=pendingAnalysis(report,'PM1_121',activities);
  assert.deepEqual(result.pending.map(student=>[student.name,...student.missing.map(item=>[item.activity.name,item.status])]),[['Bia',['Portfólio Reflexivo Avaliativo','not_submitted']]]);
  assert.equal(result.unresolved,0);
});
test('wiki coletada não cria alunos a partir de edições da equipe e acusa ausência de edição',()=>{
  const activities=[{activityId:'1',name:'Tarefa',type:'assign'},{activityId:'4',name:'Wiki',type:'wiki'}];
  const report={results:[
    {complete:true,group:{code:'PM1_121'},activityId:'4',contributorsOnly:true,records:[{userId:'10',name:'ana (wiki)',status:'recorded'},{userId:'99',name:'Tutora',status:'recorded'}]},
    {complete:true,group:{code:'PM1_121'},activityId:'1',records:[{userId:'10',name:'Ana',status:'submitted'},{userId:'11',name:'Bia',status:'submitted'}]},
  ]};
  const rows=groupMatrix(report,'PM1_121');
  assert.deepEqual(rows.map(row=>[row.name,row.states['4']?.status]),[['Ana','recorded'],['Bia',undefined]]);
  const result=pendingAnalysis(report,'PM1_121',activities);
  assert.deepEqual(result.pending.map(student=>[student.name,...student.missing.map(item=>[item.activity.name,item.status])]),[['Bia',['Wiki','not_submitted']]]);
});
test('análise sinaliza consultas ausentes sem acusar o aluno de pendência',()=>{
  const activities=[{activityId:'1',name:'Tarefa'}];
  const report={results:[{complete:false,error:'timeout',group:{code:'PM1_121'},activityId:'1',records:[]}]};
  const result=pendingAnalysis(report,'PM1_121',activities);
  assert.equal(result.pending.length,0);assert.equal(result.failedActivities.length,1);
});
test('feedback pendente exige entrega concluída e cobertura confirmada',()=>{
  const activity={activityId:'1',name:'Tarefa'};
  const report={results:[{group:{code:'PM1_121'},activityId:'1',complete:true,records:[
    {userId:'1',name:'Ana',status:'submitted'},{userId:'2',name:'Bia',status:'submitted',submittedAt:'2026-09-16T12:00:00.000Z'},{userId:'3',name:'Caio',status:'not_submitted'},
  ],evaluationRows:[{userId:'1',feedback:'Ótimo trabalho'},{userId:'2',feedback:''},{userId:'3',feedback:''}]}]};
  assert.deepEqual(feedbackPendingAnalysis(report,'PM1_121',[activity]).pending.map(item=>item.name),['Bia']);
  report.results[0].evaluationRows[1]={userId:'2',feedback:'',detailUrl:'https://moodle.test/feedback'};
  const incomplete=feedbackPendingAnalysis(report,'PM1_121',[activity]);
  assert.equal(incomplete.pending.length,0);assert.deepEqual(incomplete.uncoveredActivities.map(item=>item.name),['Tarefa']);
  assert.equal(fullDaysSince('2026-09-16T12:00:00.000Z',Date.parse('2026-09-19T13:00:00.000Z')),3);
  assert.equal(waitingDaysLabel(0),'há 0 dia');assert.equal(waitingDaysLabel(1),'há 1 dia');assert.equal(waitingDaysLabel(2),'há 2 dias');
});
test('mensagem de WhatsApp preserva atividades, situação e data ao final',()=>{
  const analysis={pending:[{userId:'1',name:'=Ana',missing:[{activity:{name:'Tarefa A'},status:'draft'}]}],unresolved:1,failedActivities:[],feedbackPending:{pending:[{userId:'1',name:'=Ana',activities:[{name:'Diário B'}]}]},rnpAttention:{cutoffPercent:85,students:[{userId:'1',name:'=Ana',percent:80,totalMinutes:96,totalSessionMinutes:120}]}};
  const message=buildPendingMessage({courseCode:'PMMFC002',groupCode:'PM1_121',contactName:'Facilitadora',analysis,updatedAt:'19/09/2026 10:30'});
  assert.match(message,/Olá, Facilitadora!/);assert.match(message,/PENDÊNCIAS DO ALUNO[\s\S]*• =Ana\n  - Entrega: Tarefa A \(Rascunho\)/);
  assert.match(message,/PENDÊNCIAS DO FACILITADOR — FEEDBACK[\s\S]*Feedback pendente: Diário B/);
  assert.match(message,/conferência no PHILA/);assert.ok(message.endsWith('Dados atualizados em: 19/09/2026 10:30'));
  assert.match(message,/Atenção RNP: 80% do tempo das sessões \(96\/120 min; limiar: 85%\)/);
  assert.match(message,/Feedback pendente: Diário B/);
  assert.deepEqual(pendingExportRows(analysis).map(row=>row.block),['Pendências do aluno','Pendências do aluno','Pendências do facilitador — feedback']);
  assert.deepEqual(pendingExportRows(analysis).map(row=>row.type),['Atenção RNP','Entrega pendente','Feedback pendente']);
  assert.equal(normalizeWhatsAppPhone('+55 (31) 99999-9999'),'5531999999999');
  assert.equal(normalizeWhatsAppPhone('123'),'');
  assert.equal(buildWhatsAppUrl('+55 (31) 99999-9999','Olá!\nLinha 2'),'https://wa.me/5531999999999?text=Ol%C3%A1!%0ALinha%202');
  assert.equal(buildWhatsAppUrl('123','texto'),'');
});
