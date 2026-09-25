// Runs in the authenticated Moodle tab; keep this function self-contained.
export async function readMoodle({ courseId, activity, group, groups, evaluations = false }) {
  const root = `${location.origin}/cepm/`;
  const parse = html => new DOMParser().parseFromString(html, 'text/html');
  const text = node => node?.textContent.replace(/\s+/g, ' ').trim() || '';
  function timestamp(cell) {
    if (!cell) return '';
    const unix = cell.querySelector('[data-timestamp]')?.dataset.timestamp || cell.dataset.timestamp;
    if (/^\d{10,13}$/.test(unix || '')) return new Date(Number(unix) * (String(unix).length === 10 ? 1000 : 1)).toISOString();
    const datetime = cell.querySelector('time[datetime]')?.getAttribute('datetime');
    if (datetime && Number.isFinite(Date.parse(datetime))) return new Date(datetime).toISOString();
    const value = text(cell).toLocaleLowerCase('pt-BR');
    const numeric = value.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[^\d]+(\d{1,2}):(\d{2}))?/);
    if (numeric) return new Date(Number(numeric[3]), Number(numeric[2]) - 1, Number(numeric[1]), Number(numeric[4] || 0), Number(numeric[5] || 0)).toISOString();
    const months = { jan:0, janeiro:0, fev:1, fevereiro:1, mar:2, marco:2, março:2, abr:3, abril:3, mai:4, maio:4, jun:5, junho:5, jul:6, julho:6, ago:7, agosto:7, set:8, setembro:8, out:9, outubro:9, nov:10, novembro:10, dez:11, dezembro:11 };
    const named = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/(\d{1,2})\s+(?:de\s+)?([a-z]{3,9})\.?\s+(?:de\s+)?(\d{4})(?:[^\d]+(\d{1,2}):(\d{2}))?/);
    if (!named) return '';
    const month = months[named[2]];
    return month === undefined ? '' : new Date(Number(named[3]), month, Number(named[1]), Number(named[4] || 0), Number(named[5] || 0)).toISOString();
  }
  // Parse JSON initializer data only; never execute page scripts or open the grader.
  function pdfWidgets(doc) {
    const widgets = [];
    for (const script of doc.scripts) {
      const source = script.textContent;
      const marker = /M\.assignfeedback_editpdf\.editor\.init\s*\(/g;
      for (const match of source.matchAll(marker)) {
        let start = match.index + match[0].length;
        while (/\s/.test(source[start] || '') && start < source.length) start++;
        if (source[start] !== '{') continue;
        let depth = 0, quoted = false, escaped = false;
        for (let i = start; i < source.length; i++) {
          const char = source[i];
          if (quoted) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') quoted = false;
          } else if (char === '"') quoted = true;
          else if (char === '{') depth++;
          else if (char === '}' && --depth === 0) {
            try { widgets.push(JSON.parse(source.slice(start, i + 1))); } catch { /* Unknown format remains pending. */ }
            break;
          }
        }
      }
    }
    return widgets;
  }
  function pdfIndex(cell, widgets, userId) {
    if (!cell) return { state: 'unknown', error: 'Coluna Anotar PDF ausente; cobertura não confirmada', files: [] };
    const anchors = [...cell.querySelectorAll('a[href]')];
    const files = [];
    for (const anchor of anchors) {
      const url = new URL(anchor.getAttribute('href'), root);
      if (url.origin === location.origin && /^\/cepm\/pluginfile\.php\/\d+\/assignfeedback_editpdf\/download\/\d+\/.+/.test(url.pathname)) {
        if (!files.some(f => f.url === url.href)) files.push({ url: url.href });
      }
    }
    const candidates = widgets.filter(w => anchors.some(a => a.id === w.linkid) && String(w.userid) === String(userId));
    const widget = candidates.find(w => w.readonly === true || w.readonly === 1);
    const valid = widget && /^\d+$/.test(String(widget.assignmentid)) && Number.isInteger(Number(widget.attemptnumber)) && Number(widget.attemptnumber) >= 0;
    if (valid) return { state: 'pending', files, source: { assignmentId: String(widget.assignmentid), userId: String(userId), attemptNumber: Number(widget.attemptnumber), readonly: true } };
    if (candidates.length && candidates.every(w => !w.readonly)) return { state: 'draft_excluded', files: [], error: 'Editor/rascunhos não consultados; publicação não confirmada' };
    if (files.length || text(cell) || anchors.length) return { state: 'unknown', files, error: 'Visualização publicada não reconhecida; texto das anotações pendente' };
    return { state: 'absent', files: [] };
  }
  async function get(url) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(url, { credentials: 'same-origin', signal: AbortSignal.timeout(45000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const doc = parse(await response.text());
        if (/\/login\/|\/sso\/|selectsource|as_login/i.test(response.url) || doc.querySelector('#login') || /Sistema de Contas/i.test(doc.title)) throw new Error('Sessão expirada');
        const errors = [...doc.querySelectorAll('.alert-danger,.errorbox')].filter(e => !/Informações de conclusão não estão ativadas/.test(text(e)));
        if (errors.some(e => /Ainda não foi inserida nenhuma questão/.test(text(e)))) throw new Error('Questionário sem questões publicadas');
        if (errors.length) throw new Error('Moodle recusou a consulta');
        return doc;
      } catch (error) {
        if (attempt || error.message === 'Sessão expirada') throw error;
      }
    }
  }
  try {
    if (!activity) {
      const doc = await get(`${root}report/progress/index.php?course=${encodeURIComponent(courseId)}`);
      const options = [...doc.querySelectorAll('select[name="group"] option')];
      const found = groups.map(code => ({ code, id: options.find(o => text(o) === code)?.value }));
      if (found.some(g => !g.id)) throw new Error('Não foi possível identificar todos os grupos deste curso');
      return { groups: found };
    }
    const type = activity.type;
    if (!['assign', 'quiz', 'diary'].includes(type)) throw new Error('Tipo sem coletor Moodle');
    const url = new URL(`mod/${type}/${type === 'assign' ? 'view' : 'report'}.php`, root);
    url.searchParams.set('id', activity.activityId);
    url.searchParams.set('group', group.id);
    if (type === 'assign') {
      for (const [key, value] of Object.entries({ action: 'grading', filter: 'all', perpage: '100', tifirst: '', tilast: '' })) url.searchParams.set(key, value);
    } else if (type === 'quiz') {
      for (const [key, value] of Object.entries({ mode: 'overview', attempts: 'enrolled_any', pagesize: '100', onlygraded: '0', tifirst: '', tilast: '' })) url.searchParams.set(key, value);
    }
    const records = [];
    const evaluationRows = [];
    const pair = value => { const m = value.match(/([\d.,]+)\s*\/\s*([\d.,]+)/); return m ? { grade: m[1], maximum: m[2] } : { grade: '', maximum: '' }; };
    const visited = new Set();
    let next = url.href;
    while (next) {
      if (visited.has(next) || visited.size >= 50) throw new Error('Paginação inconclusiva');
      visited.add(next);
      const doc = await get(next);
      const widgets = evaluations && type === 'assign' ? pdfWidgets(doc) : [];
      const selected = doc.querySelector('select[name="group"]')?.value;
      const widget = text(doc.querySelector('.groupsearchwidget'));
      if (selected !== String(group.id) && !widget.split(/\s+/).includes(group.code)) throw new Error('Filtro de grupo não confirmado');
      if (type === 'diary') {
        const entries = [...doc.querySelectorAll('table.diaryuserentry[id^="entry-"]')];
        const submissionDates = new Map(entries.filter(entry => !entry.querySelector('textarea[name^="c"]')).map(entry => [entry.id.replace('entry-', ''), timestamp(entry)]));
        // Presence of an entry proves a record; absence alone is not a negative result.
        for (const entry of entries) {
          const userId = entry.id.replace('entry-', '');
          const submittedAt = submissionDates.get(userId) || '';
          if (evaluations) {
            for (const area of entry.querySelectorAll('textarea[name^="c"]')) {
              const select = entry.querySelector('select[name^="r"]');
              const option = [...doc.querySelectorAll('select[name="jumpuser"] option')].find(o => o.value === userId);
              const feedbackDoc = parse(area.value.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/p>/gi, '\n'));
              evaluationRows.push({ userId, name: text(option), entryId: area.name.slice(1), submittedAt, ...pair(text(select?.selectedOptions[0])), feedback: feedbackDoc.body.textContent.trim(), assessedAt: text(entry.querySelector('.lastedit')), kind: 'Feedback do diário', state: 'Avaliação atual; histórico de edições não incluído' });
            }
          }
          if (/^\d+$/.test(userId) && !records.some(r => r.userId === userId)) records.push({ userId, name: '', status: 'recorded', evidence: 'Registro no diário', submittedAt });
        }
        if (!entries.length && !doc.body.id.includes('diary-report')) throw new Error('Relatório do diário não reconhecido');
      } else {
        const table = doc.querySelector(type === 'assign' ? '#submissions' : '#attempts');
        if (!table) throw new Error('Tabela não encontrada; resultado indeterminado');
        const heads = [...table.querySelectorAll('thead th')].map(text);
        const statusIndex = heads.findIndex(h => /^(Status|Situação)$/.test(h));
        if (statusIndex < 0) throw new Error('Coluna de situação não reconhecida');
        if (type === 'quiz' && doc.querySelector('select[name="attempts"]')?.value !== 'enrolled_any') throw new Error('Filtro de tentativas incompleto');
        for (const row of table.querySelectorAll('tbody tr')) {
          const links = [...row.querySelectorAll('a[href*="/user/view.php"]')];
          const cleanName = element => {
            const copy = element.cloneNode(true);
            copy.querySelectorAll('img,.userinitials,.visually-hidden,.sr-only').forEach(n => n.remove());
            return text(copy);
          };
          const link = links.find(a => cleanName(a)) || links[0];
          if (!link) continue; // Moodle pads pages with empty rows.
          const userId = new URL(link.getAttribute('href'), root).searchParams.get('id');
          const evidence = text(row.cells[statusIndex]);
          const cellAt = pattern => row.cells[heads.findIndex(h => pattern.test(h))];
          const feedbackCell = cellAt(/^Comentários de feedback$/);
          const detailLink = !evaluations ? null : type === 'assign' ? feedbackCell?.querySelector('a[href*="viewpluginassignfeedback"]') : row.querySelector('a[href*="/quiz/review.php"]');
          const detailUrl = detailLink ? new URL(detailLink.getAttribute('href'), root) : null;
          if (type === 'quiz' && detailUrl) detailUrl.searchParams.set('showall', '1');
          let status = 'unknown';
          if (type === 'assign') {
            if (/Enviado para avaliação/.test(evidence)) status = 'submitted';
            else if (/Nenhum envio/.test(evidence)) status = 'not_submitted';
            else if (/Rascunho/.test(evidence)) status = 'draft';
          } else {
            if (/Finalizada/.test(evidence)) status = 'finished';
            else if (/Em progresso/.test(evidence)) status = 'in_progress';
            else if (evidence === '-' || /Não iniciada/.test(evidence)) status = 'not_started';
          }
          const submittedAt = timestamp(cellAt(type === 'assign' ? /^Última modificação \(envio\)$/ : /^(Completo|Concluído)$/));
          records.push({ userId, name: cleanName(link), status, evidence, submittedAt });
          if (evaluations) {
            const at = cellAt;
            const gradeCell = at(type === 'assign' ? /^Nota$/ : /^Nota\s*\//);
            const gradeText = text(gradeCell?.querySelector('.w-100') || gradeCell);
            const grade = type === 'assign' ? pair(gradeText) : { grade: /^[\d.,]+$/.test(gradeText) ? gradeText : '', maximum: heads.find(h => /^Nota\s*\//.test(h))?.split('/')[1] || '' };
            evaluationRows.push({ userId, name: cleanName(link), ...grade, submittedAt, ...(type === 'assign' ? { pdf: pdfIndex(at(/^(Anotar PDF|Annotate PDF)$/), widgets, userId) } : {}), status: evidence, attemptId: detailUrl?.searchParams.get('attempt') || '', assessedAt: type === 'assign' ? text(at(/^Última modificação \(nota\)$/)) : '', completedAt: type === 'quiz' ? text(at(/^(Completo|Concluído)$/)) : '', feedback: text(feedbackCell), detailUrl: detailUrl?.href || '', kind: type === 'assign' ? 'Feedback da tarefa' : 'Avaliação do questionário', state: detailUrl ? 'Leitura completa pendente' : 'Sem feedback disponível nesta listagem' });
          }
        }
      }
      const page = Number(new URL(next).searchParams.get('page') || 0);
      const candidates = [...doc.querySelectorAll('.paging a[href],.pagination a[href]')].map(a => new URL(a.getAttribute('href'), next));
      const nextPage = candidates.find(u => u.pathname === url.pathname && u.searchParams.has('page') && Number(u.searchParams.get('page')) === page + 1);
      if (nextPage) {
        url.searchParams.set('page', String(page + 1));
        next = url.href;
      } else next = null;
    }
    return { records, evaluationRows, pages: visited.size, complete: true };
  } catch (error) {
    return { error: error.message, complete: false, records: [] };
  }
}
