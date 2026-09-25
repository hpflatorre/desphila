// Local diagnostic helper. Prints only what the supplied expression returns.
let expression = '';
for await (const chunk of process.stdin) expression += chunk;
const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const target = targets.find(t => t.type === 'page' && t.url.startsWith(process.argv[2]));
if (!target) throw new Error('Diagnostic tab unavailable');
const ws = new WebSocket(target.webSocketDebuggerUrl);
const timeout = setTimeout(() => { ws.close(); process.exitCode = 1; }, 55000);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id !== 1) return;
  clearTimeout(timeout);
  if (message.result?.exceptionDetails || message.error) {
    console.error('Browser evaluation failed; no page data emitted');
    process.exitCode = 1;
  } else console.log(JSON.stringify(message.result?.result?.value, null, 2));
  ws.close();
};
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
