// Post-call AI notes: summary + questions asked + next steps.
const { createServiceLogger } = require('../core/logger');

function buildNotesPrompt({ session, transcriptText }) {
  return [
    'You are an expert meeting-notes assistant. Analyze this interview/call transcript and produce notes.',
    `Context: ${session.company || 'Unknown company'} — ${session.role || 'Unknown role'} (mode: ${session.mode || 'auto'}).`,
    'Transcript:',
    '---',
    transcriptText || '(empty)',
    '---',
    'Output Markdown with exactly these sections:',
    '## Summary\n(a tight 5-8 line recap)',
    '## Questions Asked\n(- one bullet per question the interviewer asked)',
    '## Next Steps\n(- concrete follow-ups / prep actions)',
  ].join('\n');
}

function parseNotes(raw) {
  const text = String(raw || '');
  const pick = (re) => {
    const m = text.match(re);
    return m ? m[1].trim() : '';
  };
  const summary = pick(/##\s*Summary([\s\S]*?)(?=##\s*Questions Asked|##\s*Next Steps|$)/i);
  const questionsRaw = pick(/##\s*Questions Asked([\s\S]*?)(?=##\s*Next Steps|$)/i);
  const nextRaw = pick(/##\s*Next Steps([\s\S]*$)/i);
  const bullets = (s) => s.split('\n').map((l) => l.replace(/^\s*[-*•\d.)\s]+/, '').trim()).filter(Boolean);
  return { raw: text, summary, questions: bullets(questionsRaw), nextSteps: bullets(nextRaw) };
}

async function generateNotes({ router, session, transcriptText }) {
  const log = createServiceLogger('NOTES');
  const prompt = buildNotesPrompt({ session, transcriptText });
  const r = await router.complete({
    task: 'notes',
    messages: [
      { role: 'system', text: 'You write crisp, structured call notes. No fluff.' },
      { role: 'user', text: prompt },
    ],
    maxTokens: 1200,
    temperature: 0.3,
  });
  log.info('Notes generated', { provider: r.provider, chars: r.text.length });
  return { ...parseNotes(r.text), provider: r.provider, model: r.model, at: Date.now() };
}

module.exports = { generateNotes, buildNotesPrompt, parseNotes };
