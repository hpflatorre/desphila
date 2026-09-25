// Native DOM fixtures in an existing Chrome tab. No live requests or private data.
import { readMoodle } from '../src/lib/moodle-reader.js';
import { readPdfAnnotations, readPublishedPdf } from '../src/lib/pdf-reader.js';
import { initEvaluationReport } from '../src/evaluation-report.js';
const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const target = targets.find(t => t.type === 'page' && t.url.startsWith('chrome-extension://'));
if (!target) throw new Error('Open the extension report in diagnostic Chrome first');
const expression = `(async () => {
  let assertions = 0;
  const check = (condition, label) => { if (!condition) throw new Error(label); assertions++; };
  const location = { origin: 'https://ava.nescon.medicina.ufmg.br' };
  const widget = { linkid:'pdf-link', assignmentid:99, userid:10, attemptnumber:0, readonly:true, body:'<div>braces } { and \\"quote\\"</div>' };
  const html = (config, pdfCell, column = true) => '<html><body class="course-13"><select name="group"><option value="443" selected>PM1_121</option></select><table id="submissions"><thead><tr><th>Aluno</th><th>Status</th><th>Nota</th><th>Comentários de feedback</th>' + (column ? '<th>Anotar PDF</th>' : '') + '</tr></thead><tbody><tr><td><a href="/cepm/user/view.php?id=10">Aluno Sintético</a></td><td>Enviado para avaliação</td><td><div class="w-100">0,00 / 100,00</div></td><td>Texto</td>' + (column ? '<td>' + pdfCell + '</td>' : '') + '</tr><tr><td></td></tr></tbody></table><script>M.assignfeedback_editpdf.editor.init(' + JSON.stringify(config) + ');<\/script></body></html>';
  const pdfCell = '<a href="/cepm/pluginfile.php/55/assignfeedback_editpdf/download/777/feedback.pdf">PDF</a><a id="pdf-link" href="#">Visualizar PDF</a>';
  async function index(documentHtml) {
    const fetch = async () => ({ ok:true, url:location.origin + '/cepm/mod/assign/view.php', text:async()=>documentHtml });
    const read = ${readMoodle.toString()};
    return read({courseId:'13',activity:{type:'assign',activityId:'819'},group:{code:'PM1_121',id:'443'},evaluations:true});
  }
  const indexed = await index(html(widget, pdfCell));
  check(indexed.complete && indexed.evaluationRows.length===1, 'Native DOM index');
  check(indexed.evaluationRows[0].pdf.source.assignmentId==='99', 'JSON initializer');
  check(indexed.evaluationRows[0].pdf.files.length===1, 'Published PDF link');
  check(indexed.evaluationRows[0].grade==='0,00', 'Zero grade');
  check((await index(html(widget,''))).evaluationRows[0].pdf.state==='absent', 'Empty column');
  check((await index(html(widget,'',false))).evaluationRows[0].pdf.state==='unknown', 'Missing column');
  check((await index(html({...widget,readonly:false},pdfCell))).evaluationRows[0].pdf.state==='draft_excluded', 'Editable widget excluded');
  check((await index(html({...widget,userid:11},pdfCell))).evaluationRows[0].pdf.state==='unknown', 'Different student rejected');
  check((await index(html({...widget,attemptnumber:-1},pdfCell))).evaluationRows[0].pdf.state==='unknown', 'Unknown attempt rejected');
  check((await index(html(widget,'<a href="https://example.invalid/cepm/pluginfile.php/55/assignfeedback_editpdf/download/777/f.pdf">PDF</a>'))).evaluationRows[0].pdf.files.length===0, 'Foreign URL rejected');
  const requests = [];
  const fetch = async (value, options) => {
    const url = new URL(value, location.origin); requests.push({url,options});
    if (url.pathname==='/cepm/course/view.php') return { ok:true,url:url.href,text:async()=>'<body class="course-13"><script>M.cfg={"sesskey":"SYNTHETIC"};<\/script></body>' };
    if (url.pathname.endsWith('/ajax.php')) return { ok:true, json:async()=>({pagecount:1,partial:false,pages:[{comments:[],annotations:[],url:'DO-NOT-PERSIST'}]}) };
    if (url.pathname.endsWith('/bad.pdf')) return new Response('<html>login</html>');
    if (url.pathname.endsWith('/large.pdf')) return new Response('',{headers:{'Content-Length':String(21*1024*1024)}});
    if (url.pathname.includes('/pluginfile.php/')) return new Response('%PDF-1.4\\nfixture');
    throw new Error('Unexpected route');
  };
  const readAnnotations = ${readPdfAnnotations.toString()};
  const readFile = ${readPublishedPdf.toString()};
  const source = {assignmentId:'99',userId:'10',attemptNumber:0,courseId:'13',readonly:true};
  const result = await readAnnotations({source});
  check(!!result.payload && result.payload.pages.length===1, 'Annotations response');
  check(!JSON.stringify(result).includes('DO-NOT-PERSIST'), 'Image URL not persisted');
  const ajax = requests.find(r=>r.url.pathname.endsWith('/ajax.php'));
  check(ajax.url.searchParams.get('action')==='pollconversions' && ajax.url.searchParams.get('readonly')==='1', 'Read-only request');
  const requestCount = requests.length;
  check(!!(await readAnnotations({source:{...source,readonly:false}})).error && requests.length===requestCount, 'Draft blocked before fetch');
  const base = location.origin + '/cepm/pluginfile.php/55/assignfeedback_editpdf/download/777/';
  check((await readFile({url:base+'file.pdf'})).base64===btoa('%PDF-1.4\\nfixture'), 'PDF bytes round-trip');
  check(!!(await readFile({url:base+'bad.pdf'})).error, 'HTML never saved as PDF');
  check(!!(await readFile({url:base+'large.pdf'})).error, 'Size cap');
  const before = requests.length;
  check(!!(await readFile({url:'https://example.invalid/f.pdf'})).error && requests.length===before, 'External fetch blocked');
  check(requests.filter(r=>r.url.pathname.includes('/pluginfile.php/')).every(r=>r.options.redirect==='error'), 'Download redirects blocked');
  {
    // Exercise the real UI controller against detached DOM, in-memory storage and mock transport.
    const { evaluationCsv, evaluationRows } = await import('/src/lib/evaluation-model.js');
    const { pdfFiles, safePart } = await import('/src/lib/pdf-model.js');
    const { storedZip } = await import('/src/lib/zip.js');
    const { csvCell } = await import('/src/lib/report-model.js');
    const { showAge, oldestSuccessfulTimestamp } = await import('/src/lib/time-age.js');
    const document = new DOMParser().parseFromString('<select id="evaluation-scope"></select><button id="evaluation-start"></button><button id="evaluation-stop"></button><button id="evaluation-refresh"></button><button id="evaluation-export"></button><button id="evaluation-package"></button><p id="evaluation-status"></p>', 'text/html');
    const storage = {}, downloads = []; let indexes = 0, annotationCalls = 0, failDownload = false, failDiscovery = false, failSave = false, missingGroups = false, stopAfterIndex = false;
    const chrome = { storage:{local:{get:async key=>({[key]:structuredClone(storage[key])}),set:async values=>{if(failSave)throw new Error('Synthetic storage failure');Object.assign(storage,structuredClone(values));}}},runtime:{sendMessage:async msg=>{
      if (!msg.activityId) return failDiscovery ? {error:'Synthetic discovery failure'} : {groups:missingGroups ? [] : [{code:'PM1_121',id:'443'}]};
      if (msg.pdf?.kind==='annotations') {
        annotationCalls++;
        if (annotationCalls===1) return {error:'Synthetic timeout'};
        return {details:[{kind:'Comentário no PDF',feedback:'Comentário sintético',page:1,publication:'Publicada'}],pages:1,partial:false,draftsExcluded:0};
      }
      if (msg.pdf?.kind==='file') return failDownload ? {error:'Synthetic download failure'} : {base64:btoa('%PDF-1.4\\nfixture')};
      indexes++;
      if(stopAfterIndex){stopAfterIndex=false;document.querySelector('#evaluation-stop').onclick();}
      if(msg.activityId==='820')return {complete:true,evaluationRows:[{userId:'10',name:'Aluno Sintético',feedback:'Diário',grade:''}]};
      return {complete:true,evaluationRows:[{userId:'10',name:'Aluno Sintético',grade:'0',pdf:{state:'pending',source:{assignmentId:'99',userId:'10',attemptNumber:0,readonly:true},files:[{url:'https://example.invalid/fixture.pdf'}]}}]};
    }}};
    const create = document.createElement.bind(document);
    document.createElement = name => { const node=create(name); if(name==='a') node.click=()=>{}; return node; };
    const URL = { createObjectURL:blob=>{downloads.push(blob);return 'blob:fixture';},revokeObjectURL:()=>{} };
    const setTimeout = ()=>0;
    const confirm = ()=>true;
    const init = ${initEvaluationReport.toString()};
    await init({courseId:'fixture13',moduleCode:'FIXTURE',activities:[{type:'assign',activityId:'819',name:'Sintético'},{type:'diary',activityId:'820',name:'Diário sintético'}]},['PM1_121']);
    const changeScope = async value => { const scope=document.querySelector('#evaluation-scope');scope.value=value;scope.dispatchEvent(new Event('change'));await new Promise(resolve=>globalThis.setTimeout(resolve,0)); };
    await changeScope('819');
    await document.querySelector('#evaluation-start').onclick();
    check(document.querySelector('#evaluation-status').textContent.includes('1 leituras PDF'), 'PDF error visible');
    await document.querySelector('#evaluation-start').onclick();
    check(indexes===1 && annotationCalls===2, 'Resume retries failed annotations only');
    check(document.querySelector('#evaluation-status').textContent.includes('0 leituras PDF'), 'PDF retry complete');
    check(!document.querySelector('#evaluation-package').disabled, 'Package button enabled');
    await document.querySelector('#evaluation-package').onclick();
    check(downloads.length===1 && downloads[0].type==='application/zip', 'ZIP UI output');
    const zipText = await downloads[0].text();
    check(zipText.includes('notas-feedbacks.csv') && zipText.includes('%PDF-1.4') && zipText.includes('Incluído no ZIP'), 'ZIP contains PDF, CSV and receipt');
    failDownload=true;
    await document.querySelector('#evaluation-package').onclick();
    const failedZip=await downloads[1].text();
    check(failedZip.includes('Synthetic download failure') && !failedZip.includes('%PDF-1.4'), 'Failure recorded, no phantom PDF');
    check(document.querySelector('#evaluation-status').textContent.includes('0/1 PDFs'), 'Incomplete package visible');
    const snapshot=JSON.stringify(storage['evaluationExport:fixture13:819']);
    for(const failure of ['discovery','storage','groups']){
      failDiscovery=failure==='discovery';failSave=failure==='storage';missingGroups=failure==='groups';
      await document.querySelector('#evaluation-refresh').onclick();
      check(JSON.stringify(storage['evaluationExport:fixture13:819'])===snapshot, 'Failed refresh preserves snapshot: '+failure);
      check(!document.querySelector('#evaluation-export').disabled, 'Failed refresh keeps previous export: '+failure);
    }
    failDiscovery=false;failSave=false;missingGroups=false;
    await changeScope('all');stopAfterIndex=true;
    await document.querySelector('#evaluation-start').onclick();
    const interrupted=storage['evaluationExport:fixture13:all'];
    check(interrupted.jobs.length===2 && interrupted.jobs[0].complete && !interrupted.jobs[1].complete && !interrupted.finished, 'Course collection stops after current query');
    const indexesBefore=indexes;
    await document.querySelector('#evaluation-start').onclick();
    check(storage['evaluationExport:fixture13:all'].jobs.every(job=>job.complete) && indexes===indexesBefore+1, 'Course resume preserves successful indexes');
    check(JSON.stringify(storage['evaluationExport:fixture13:819'])===snapshot, 'Activity and course snapshots stay isolated');
    await changeScope('819');
    check(!document.querySelector('#evaluation-export').disabled && !document.querySelector('#evaluation-package').disabled, 'Activity snapshot restored after course collection');
  }
  return {assertions,liveRequests:0};
})()`;
const ws = new WebSocket(target.webSocketDebuggerUrl);
const timeout = setTimeout(() => { ws.close(); process.exitCode = 1; }, 15000);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id !== 1) return;
  clearTimeout(timeout);
  if (message.result?.exceptionDetails || message.error) {
    console.error(message.result?.exceptionDetails?.exception?.description || 'Fixture evaluation failed'); process.exitCode = 1;
  } else console.log(JSON.stringify(message.result.result.value));
  ws.close();
};
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
