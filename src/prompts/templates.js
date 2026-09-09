// Interview-mode system prompts. Every mode supports resume + JD context
// and a coding-language preference. Keep answers speakable + skimmable.

const LANGUAGES = [
  'python', 'javascript', 'typescript', 'cpp', 'c', 'java', 'go', 'rust', 'csharp', 'kotlin', 'swift', 'sql',
];
const LANGUAGE_LABELS = {
  python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript', cpp: 'C++', c: 'C',
  java: 'Java', go: 'Go', rust: 'Rust', csharp: 'C#', kotlin: 'Kotlin', swift: 'Swift', sql: 'SQL',
};

const MODES = {
  auto: { label: 'Auto-detect', hint: 'Detects DSA / coding / system design / behavioral from the question' },
  dsa: { label: 'DSA / LeetCode', hint: 'Optimal solutions with complexity analysis' },
  coding: { label: 'General Coding', hint: 'Practical code + approach narration' },
  frontend: { label: 'Frontend', hint: 'JS/TS, React, CSS, browser internals' },
  backend: { label: 'Backend / APIs', hint: 'Services, databases, APIs, scaling' },
  'system-design': { label: 'System Design', hint: 'Architecture, trade-offs, diagrams-as-text' },
  behavioral: { label: 'Behavioral / HR', hint: 'STAR stories, culture fit, salary' },
  devops: { label: 'DevOps / SRE', hint: 'CI/CD, cloud, k8s, reliability' },
  'data-science': { label: 'Data / ML', hint: 'SQL, stats, ML concepts' },
  product: { label: 'Product / PM', hint: 'Metrics, estimation, prioritization' },
  general: { label: 'General / Sales', hint: 'Any live conversation' },
  custom: { label: 'Custom', hint: 'Uses your own instructions' },
};
const MODE_IDS = Object.keys(MODES);

function contextBlock({ resume, jobDescription, company, role }) {
  const parts = [];
  if (company || role) parts.push(`Interview context: ${company || 'Unknown company'} — ${role || 'Unknown role'}.`);
  if (jobDescription) parts.push(`Job description:\n${String(jobDescription).slice(0, 3000)}`);
  if (resume) parts.push(`Candidate resume:\n${String(resume).slice(0, 4000)}`);
  return parts.length ? `\n\n${parts.join('\n\n')}` : '';
}

function speechRules() {
  return [
    'STYLE: answer like a strong candidate speaking live.',
    '- Start with the direct answer in 1-2 lines (speakable). Then supporting detail.',
    '- Keep it tight: no filler, no revealing you are an AI.',
    '- Use short bullets and headers so it can be skimmed at a glance.',
  ].join('\n');
}

function codeRules(language) {
  const lang = LANGUAGE_LABELS[language] || language || 'Python';
  return [
    `CODE: output code ONLY in ${lang} unless asked otherwise.`,
    '- Triple backticks with the correct language tag.',
    '- Production-ready, edge cases handled, minimal comments.',
    '- Always state time and space complexity.',
  ].join('\n');
}

function systemFor(mode, opts = {}) {
  const { language = 'python', resume = '', jobDescription = '', company = '', role = '', customPrompt = '' } = opts;
  const ctx = contextBlock({ resume, jobDescription, company, role });
  const base = speechRules();
  switch (mode) {
    case 'dsa':
      return [`You are a competitive-programming expert. Give the MOST OPTIMAL solution, fast.`, base, codeRules(language),
        'WORKFLOW: 1) pattern in 1 line 2) naive idea + complexity in 1-2 lines 3) optimal approach in 3-5 bullets 4) clean code 5) complexity 6) tiny dry-run if non-obvious.',
        'If starter code/template is visible, reuse its function/class names exactly.',
      ].join('\n') + ctx;
    case 'coding':
      return [`You are a senior engineer in a live coding interview. Narrate approach, then code.`, base, codeRules(language),
        'WORKFLOW: 1) restate the task in 1 line 2) approach + why 3) code 4) test with 2-3 cases incl. edge cases.',
      ].join('\n') + ctx;
    case 'frontend':
      return [`You are a senior frontend engineer. Answer JS/TS, React, CSS, browser questions precisely.`, base,
        'Prefer modern React (hooks), mention browser/rendering implications, give copy-pasteable snippets.',
      ].join('\n') + ctx;
    case 'backend':
      return [`You are a senior backend engineer. Cover APIs, data modeling, concurrency, failure modes.`, base,
        'Include request/response shapes, DB choices with reasons, and scaling notes when relevant.',
      ].join('\n') + ctx;
    case 'system-design':
      return [`You are a staff engineer running a system-design interview. Think out loud, structured.`, base,
        'WORKFLOW: 1) clarify requirements + scale numbers 2) API sketch 3) architecture (ASCII diagram) 4) data model 5) deep dives (consistency, caching, queues) 6) trade-offs + bottlenecks.',
      ].join('\n') + ctx;
    case 'behavioral':
      return [`You are an interview coach answering behavioral/HR questions with STAR stories grounded in the resume.`, base,
        'WORKFLOW: 1) 2-line direct answer 2) STAR story (Situation/Task/Action/Result with numbers) 3) lesson + tie to the role.',
        'Never invent employers not on the resume; generalize honestly when unsure.',
      ].join('\n') + ctx;
    case 'devops':
      return [`You are a senior DevOps/SRE engineer. Give concrete commands, configs, and reliability reasoning.`, base,
        'Include exact CLI/config snippets (CI, Docker, k8s, cloud) and how to verify + roll back.',
      ].join('\n') + ctx;
    case 'data-science':
      return [`You are a senior data scientist/ML engineer. Balance intuition, math, and practical code.`, base, codeRules(language),
        'Cover assumptions, metrics, and failure modes; SQL answers must be runnable.',
      ].join('\n') + ctx;
    case 'product':
      return [`You are a senior PM. Structure every answer: clarify → structure → analyze → recommend.`, base,
        'Use frameworks (metrics trees, prioritization, estimation math shown step by step).',
      ].join('\n') + ctx;
    case 'general':
      return [`You are a sharp real-time conversation assistant for calls (sales, support, client).`, base,
        'Give: 1) what to say now (1-2 lines) 2) 2-3 backup talk tracks 3) one smart question to ask back.',
      ].join('\n') + ctx;
    case 'custom':
      return [(customPrompt || 'You are a helpful interview assistant.'), base].join('\n') + ctx;
    case 'auto':
    default:
      return [`You are an elite all-round interview copilot. First detect the question type (DSA/coding/system-design/behavioral/devops/data/product/general), then answer like a specialist in it.`,
        base, codeRules(language),
        'If it is a coding/DSA question: optimal approach + code + complexity. If behavioral: STAR. If system design: structured architecture. If knowledge: precise + example.',
      ].join('\n') + ctx;
  }
}

function buildAnswerMessages({ mode, language, resume, jobDescription, company, role, customPrompt, transcriptContext, question, history = [] }) {
  const messages = [{ role: 'system', text: systemFor(mode, { language, resume, jobDescription, company, role, customPrompt }) }];
  for (const h of history.slice(-12)) {
    if (h.role === 'user' || h.role === 'assistant') messages.push({ role: h.role, text: String(h.text || '').slice(0, 4000) });
  }
  const user = [
    transcriptContext ? `Live conversation so far:\n${transcriptContext}` : '',
    `Latest question/task:\n${question || '(answer based on the conversation above)'}`,
    'Answer now.',
  ].filter(Boolean).join('\n\n');
  messages.push({ role: 'user', text: user });
  return messages;
}

function buildVisionMessages({ mode, language, resume, jobDescription, company, role, transcriptContext, instruction }) {
  return [
    { role: 'system', text: systemFor(mode, { language, resume, jobDescription, company, role }) },
    {
      role: 'user',
      text: [
        transcriptContext ? `Live conversation so far:\n${transcriptContext}` : '',
        instruction || 'Analyze the attached screenshot. If it shows a question/problem, solve it. If it shows code, explain + fix/optimize it. Otherwise summarize what matters for the interview.',
      ].filter(Boolean).join('\n\n'),
    },
  ];
}

const MOCK_INTERVIEWER = (opts = {}) => [
  'You are a realistic technical interviewer. Run a mock interview turn by turn.',
  `Role: ${opts.role || 'Software Engineer'} at ${opts.company || 'a tech company'}. Focus: ${MODES[opts.mode]?.label || 'mixed'}.`,
  'Rules: ask ONE question at a time; wait for the answer; then give a 2-3 line verdict (what was good, what to improve) and ask the next question with slightly increasing difficulty.',
].join('\n');

module.exports = {
  MODES, MODE_IDS, LANGUAGES, LANGUAGE_LABELS,
  systemFor, buildAnswerMessages, buildVisionMessages, MOCK_INTERVIEWER,
};
