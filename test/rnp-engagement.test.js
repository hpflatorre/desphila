import test from 'node:test';
import assert from 'node:assert/strict';
import { engagementDataUrl, summarizeRnpEngagement } from '../src/lib/rnp-engagement.js';

const S3 = 'https://data-confweb-prd.s3.sa-east-1.amazonaws.com/a/b/learning_dashboard.json?X-Amz-Signature=1';

test('aceita somente o JSON do painel no bucket do RNP', () => {
  assert.equal(engagementDataUrl(`https://ld.mconf.rnp.br/engagement/?data=${encodeURIComponent(S3)}&lang=pt-BR`), S3);
  assert.equal(engagementDataUrl(`https://ld.mconf.rnp.br/engagement/?data=${encodeURIComponent('https://evil.test/learning_dashboard.json')}`), null);
  assert.equal(engagementDataUrl(`https://ld.mconf.rnp.br/engagement/?data=${encodeURIComponent(S3.replace('learning_dashboard', 'outro'))}`), null);
  assert.equal(engagementDataUrl(null), null);
});

test('resume engajamento sem contar reconexões e câmeras sobrepostas em dobro', () => {
  const minute = 60_000;
  const summary = summarizeRnpEngagement({
    createdOn: 0, endedOn: 120 * minute,
    polls: { p1: {}, p2: {} },
    screenshares: [{ startedOn: 0, stoppedOn: 10 * minute }],
    users: {
      a: {
        extId: '3464', name: 'Bia', isModerator: false,
        intIds: { x: { sessions: [{ registeredOn: 5 * minute, leftOn: 50 * minute }] }, y: { sessions: [{ registeredOn: 40 * minute, leftOn: 0 }] } },
        talk: { totalTime: 3 * minute }, webcams: [{ startedOn: 10 * minute, stoppedOn: 30 * minute }, { startedOn: 20 * minute, stoppedOn: 40 * minute }],
        away: [{ startedOn: 60 * minute, stoppedOn: 70 * minute }], raiseHand: [1, 2], reactions: [{}], answers: { p1: 'A' },
        totalOfMessages: 4, totalOfSharedNotes: 1, totalOfWhiteboardAnnotations: 2,
      },
      b: { extId: 'guest_123', name: 'Ana', isModerator: true, intIds: {}, talk: {}, webcams: [], raiseHand: [], reactions: [], answers: {} },
    },
  });
  assert.equal(summary.polls, 2);
  assert.equal(summary.screenshareSeconds, 600);
  assert.deepEqual(summary.participants.map(person => person.name), ['Ana', 'Bia']);
  const bia = summary.participants[1];
  assert.equal(bia.moodleUserId, '3464');
  assert.equal(bia.connections, 2);
  assert.equal(bia.onlineSeconds, 115 * 60); // 5 min → end of meeting, overlap merged
  assert.equal(bia.lastLeftAt, new Date(120 * minute).toISOString());
  assert.equal(bia.webcamSeconds, 30 * 60);
  assert.equal(bia.awaySeconds, 10 * 60);
  assert.equal(bia.talkSeconds, 180);
  assert.deepEqual([bia.messages, bia.raisedHands, bia.reactions, bia.pollAnswers, bia.sharedNotes, bia.whiteboardAnnotations], [4, 2, 1, 1, 1, 2]);
  const ana = summary.participants[0];
  assert.equal(ana.moodleUserId, '');
  assert.equal(ana.moderator, true);
  assert.equal(ana.firstJoinedAt, '');
  assert.throws(() => summarizeRnpEngagement({}), /não reconhecido/);
});

test('une reconexões com o mesmo ID externo e calcula a pontuação do painel', () => {
  const minute = 60_000;
  const user = (extId, start, end, talk, extra = {}) => ({ extId, name: `P${extId}`, intIds: { i: { sessions: [{ registeredOn: start * minute, leftOn: end * minute }] } }, talk: { totalTime: talk * minute }, webcams: [], raiseHand: [], reactions: [], answers: {}, totalOfMessages: 0, ...extra });
  const { participants } = summarizeRnpEngagement({
    createdOn: 0, endedOn: 130 * minute, polls: {},
    users: {
      k1: user('10', 0, 20, 2), k2: user('10', 15, 120, 1.5, { raiseHand: [1, 2] }),
      k3: user('11', 0, 120, 6, { totalOfMessages: 2, raiseHand: [1, 2, 3] }),
      k4: user('12', 0, 130, 70, { isModerator: true, totalOfMessages: 9 }),
    },
  });
  const byId = Object.fromEntries(participants.map(person => [person.externalId, person]));
  assert.equal(participants.length, 3);
  assert.equal(byId['10'].connections, 2);
  assert.equal(byId['10'].onlineSeconds, 120 * 60);
  assert.equal(byId['10'].talkSeconds, 210);
  assert.equal(byId['10'].activityScore, 2.5); // 2·3.5/6 + 2·2/3
  assert.equal(byId['11'].activityScore, 6);
  assert.equal(byId['12'].activityScore, null);
});
