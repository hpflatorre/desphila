// Executed only after a status click, inside the authenticated Moodle tab.
export async function resolveStudentDestination({ activity, group, userId }) {
  const root = `${location.origin}/cepm/`;
  const type = activity.type;
  if (!['assign', 'quiz', 'diary'].includes(type) || !/^\d+$/.test(String(userId))) throw new Error('Destino inválido');
  const url = new URL(`mod/${type}/${type === 'assign' ? 'view' : 'report'}.php`, root);
  url.searchParams.set('id', activity.activityId);
  if (group?.id) url.searchParams.set('group', group.id);
  const params = type === 'assign' ? { action: 'grading', filter: 'all', perpage: '100', tifirst: '', tilast: '' }
    : type === 'quiz' ? { mode: 'overview', attempts: 'enrolled_any', pagesize: '100', onlygraded: '0', tifirst: '', tilast: '' } : {};
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const fallback = url.href;
  const visited = new Set();
  while (visited.size < 50 && !visited.has(url.href)) {
    visited.add(url.href);
    const response = await fetch(url, { credentials: 'same-origin', signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error(`Moodle respondeu HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    if (/\/login\/|\/sso\//i.test(response.url) || doc.querySelector('#login')) throw new Error('Sessão expirada. Abra o Moodle autenticado.');
    if (doc.querySelector('.alert-danger,.errorbox')) throw new Error('Moodle não disponibilizou a avaliação.');
    if (group?.id && doc.querySelector('select[name="group"]')?.value !== String(group.id)
      && !doc.querySelector('.groupsearchwidget')?.textContent.split(/\s+/).includes(group.code)) throw new Error('Filtro de turma não confirmado');
    if (type === 'diary') {
      const entry = doc.getElementById(`entry-${userId}`);
      if (entry) { url.hash = entry.id; return { url: url.href, individual: true }; }
    } else {
      const rows = [...doc.querySelectorAll(type === 'assign' ? '#submissions tbody tr' : '#attempts tbody tr')];
      for (const row of rows) {
        const belongs = [...row.querySelectorAll('a[href*="/user/view.php"]')].some(link => new URL(link.getAttribute('href'), root).searchParams.get('id') === String(userId));
        if (!belongs) continue;
        for (const link of row.querySelectorAll('a[href]')) {
          const target = new URL(link.getAttribute('href'), root);
          if (target.origin !== location.origin || target.username || target.password || target.searchParams.has('sesskey')) continue;
          const valid = type === 'assign'
            ? target.pathname === '/cepm/mod/assign/view.php' && target.searchParams.get('id') === String(activity.activityId) && target.searchParams.get('action') === 'grader' && target.searchParams.get('userid') === String(userId)
            : target.pathname === '/cepm/mod/quiz/review.php' && /^\d+$/.test(target.searchParams.get('attempt') || '');
          if (valid) return { url: target.href, individual: true };
        }
      }
    }
    const page = Number(url.searchParams.get('page') || 0);
    const hasNext = [...doc.querySelectorAll('.paging a[href],.pagination a[href]')].some(link => {
      const candidate = new URL(link.getAttribute('href'), url);
      return candidate.origin === url.origin && candidate.pathname === url.pathname && candidate.searchParams.has('page') && Number(candidate.searchParams.get('page')) === page + 1;
    });
    if (!hasNext) return { url: fallback, individual: false };
    url.searchParams.set('page', String(page + 1));
  }
  throw new Error('Busca da entrega inconclusiva; tente novamente.');
}
