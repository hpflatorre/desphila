// Injected into Moodle. Read-only, constrained to assessment detail pages.
export async function readFeedbackDetail({ courseId, activity, url }) {
  try {
    const target = new URL(url);
    if (target.origin !== location.origin) throw new Error('Origem inválida');
    const assignment = activity.type === 'assign';
    if (assignment ? target.pathname !== '/cepm/mod/assign/view.php' || target.searchParams.get('id') !== String(activity.activityId) || target.searchParams.get('action') !== 'viewpluginassignfeedback' || target.searchParams.get('plugin') !== 'comments' : activity.type !== 'quiz' || target.pathname !== '/cepm/mod/quiz/review.php' || !/^\d+$/.test(target.searchParams.get('attempt'))) throw new Error('Página de feedback inválida');
    const response = await fetch(target, { credentials: 'same-origin', signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    if (/\/login\/|\/sso\/|selectsource|as_login/i.test(response.url) || doc.querySelector('#login') || /Sistema de Contas/i.test(doc.title)) throw new Error('Sessão expirada');
    if (!doc.body.classList.contains(`course-${courseId}`)) throw new Error('Curso do feedback não confirmado');
    const content = node => {
      const copy = node.cloneNode(true);
      copy.querySelectorAll('script,style').forEach(n => n.remove());
      copy.querySelectorAll('br').forEach(n => n.replaceWith('\n'));
      copy.querySelectorAll('p,div,li').forEach(n => n.append('\n'));
      return copy.textContent.trim();
    };
    if (assignment) {
      const full = doc.querySelector('.feedbackfull');
      if (!full) throw new Error('Feedback completo não encontrado');
      return { details: [{ feedback: content(full), kind: 'Feedback da tarefa' }] };
    }
    if (!doc.querySelector('.quizreviewsummary')) throw new Error('Revisão indisponível');
    const details = [];
    for (const row of doc.querySelectorAll('.quizreviewsummary tr')) {
      if (/feedback/i.test(row.querySelector('th')?.textContent || '')) {
        const value = row.querySelector('td');
        if (value) details.push({ feedback: content(value), kind: 'Feedback geral da tentativa' });
      }
    }
    for (const question of doc.querySelectorAll('.que')) {
      const grade = question.querySelector('.grade')?.textContent.match(/([\d.,]+)\s+de\s+([\d.,]+)/);
      const nodes = [...question.querySelectorAll('.specificfeedback,.generalfeedback,.manualcomment,.comment')];
      for (const node of nodes.filter(n => !nodes.some(other => other !== n && other.contains(n)))) {
        const feedback = content(node);
        if (feedback) details.push({ feedback, kind: node.classList.contains('specificfeedback') ? 'Feedback específico' : node.classList.contains('generalfeedback') ? 'Feedback geral da questão' : 'Comentário', question: question.querySelector('.qno')?.textContent.trim() || question.id, questionGrade: grade?.[1] || '', questionMaximum: grade?.[2] || '' });
      }
    }
    return { details: details.length ? details : [{ feedback: '', kind: 'Sem feedback textual na revisão' }] };
  } catch (error) { return { error: error.message }; }
}
