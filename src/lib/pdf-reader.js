// Self-contained injected reader. Only the published read-only viewer is queried.
export async function readPdfAnnotations({ source }) {
  try {
    if (source?.readonly !== true || !/^\d+$/.test(source.assignmentId) || !/^\d+$/.test(source.userId) || !Number.isInteger(source.attemptNumber) || source.attemptNumber < 0) throw new Error('Origem publicada inválida');
    // ISOLATED world cannot access M.cfg. Fetch the course page config without running it.
    const response = await fetch(`/cepm/course/view.php?id=${encodeURIComponent(source.courseId)}`, { credentials: 'same-origin', signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    if (response.url.includes('/login/') || doc.querySelector('#login')) throw new Error('Sessão expirada');
    if (!doc.body.classList.contains(`course-${source.courseId}`)) throw new Error('Curso não confirmado');
    const scripts = [...doc.scripts].map(s => s.textContent).join('\n');
    const sesskey = scripts.match(/"sesskey"\s*:\s*"([a-zA-Z0-9]+)"/)?.[1];
    if (!sesskey) throw new Error('Sessão Moodle não identificada');
    const url = new URL('/cepm/mod/assign/feedback/editpdf/ajax.php', location.origin);
    url.search = new URLSearchParams({ action: 'pollconversions', assignmentid: source.assignmentId, userid: source.userId, attemptnumber: String(source.attemptNumber), readonly: '1', sesskey }).toString();
    const result = await fetch(url, { credentials: 'same-origin', signal: AbortSignal.timeout(45000) });
    if (!result.ok) throw new Error(`HTTP ${result.status}`);
    const payload = await result.json();
    if (payload.error || payload.exception) throw new Error('Moodle recusou a leitura das anotações');
    // Filter returned fields: never persist tokens, image URLs or arbitrary server payloads.
    if (!Array.isArray(payload.pages)) throw new Error('Resposta PDF não reconhecida');
    return { payload: { partial: payload.partial, pagecount: payload.pagecount, pages: payload.pages.map(page => ({ comments: page.comments, annotations: page.annotations })) } };
  } catch (error) {
    return { error: error.name === 'TimeoutError' ? 'Tempo de leitura excedido (45 s); retome a pendência' : /^(HTTP |Sessão|Curso|Origem|Resposta|Moodle)/.test(error.message) ? error.message : 'Falha ao ler anotações; retome a pendência' };
  }
}

// Downloads only existing published feedback files. Never generate a PDF on the server.
export async function readPublishedPdf({ url }) {
  try {
    const target = new URL(url);
    if (target.origin !== location.origin || !/^\/cepm\/pluginfile\.php\/\d+\/assignfeedback_editpdf\/download\/\d+\/.+/.test(target.pathname)) throw new Error('Arquivo fora da área de feedback publicado');
    const limit = 20 * 1024 * 1024;
    const response = await fetch(target, { credentials: 'same-origin', signal: AbortSignal.timeout(45000), redirect: 'error' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (Number(response.headers.get('content-length')) > limit) throw new Error('PDF excede 20 MiB; baixe individualmente no Moodle');
    const reader = response.body.getReader();
    const chunks = []; let length = 0;
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.length;
      if (length > limit) { await reader.cancel(); throw new Error('PDF excede 20 MiB; baixe individualmente no Moodle'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('Resposta não é PDF; sessão expirada ou arquivo indisponível');
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return { base64: btoa(binary), size: length };
  } catch (error) {
    return { error: /^(HTTP |PDF |Resposta |Arquivo )/.test(error.message) ? error.message : 'Falha no download (sessão, rede ou limite de 45 s); tente novamente' };
  }
}
