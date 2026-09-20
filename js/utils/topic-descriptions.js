// One-sentence summaries of what each topic page covers. Shown on the MOBILE
// topic-page hero header only (the desktop layout doesn't display them). Keyed
// by topic slug; getTopicDescription() falls back to '' for unknown slugs.
export const TOPIC_DESCRIPTIONS = {
  // ── Parent topics ──────────────────────────────────────────────────────────
  'world': 'Breaking news, conflicts, and developments from every region of the globe.',
  'politics': 'Elections, policy, the courts, and the people shaping government.',
  'business-finance': 'Markets, finance, deals, the economy, and the companies driving them.',
  'technology': 'AI, startups, gadgets, and the platforms reshaping how we live and work.',
  'sports': 'Scores, trades, and storylines across the leagues and athletes you follow.',
  'science': 'Discoveries and research across space, physics, and the life sciences.',
  'health-wellness': 'Medicine, wellness, fitness, nutrition, and the science of living well.',
  'climate-environment': 'Climate policy, clean energy, conservation, and a changing planet.',
  'entertainment': 'Everything happening in movies, TV, music, gaming, and celebrity culture.',
  'arts-culture': 'Arts, books, design, fashion, food, and the wider world of culture.',
  'lifestyle': 'Travel, cars, home, careers, and the way we live day to day.',
  'media': 'The business of journalism, advertising, and the platforms behind the news.',
  'education': 'Schools, higher ed, and the technology changing how we learn.',
  'ideas-opinion-more': 'Big ideas, history, philosophy, faith, and perspectives worth weighing.',

  // ── Business & Finance ──────────────────────────────────────────────────────

  // ── Technology ──────────────────────────────────────────────────────────────
  'artificial-intelligence': 'Artificial intelligence: the models, labs, research, policy, and the products built on AI.',

  // ── Science ─────────────────────────────────────────────────────────────────

  // ── Health & Wellness ───────────────────────────────────────────────────────

  // ── Politics ────────────────────────────────────────────────────────────────

  // ── World ───────────────────────────────────────────────────────────────────

  // ── Sports ──────────────────────────────────────────────────────────────────

  // ── Climate & Environment ─────────────────────────────────────────────────────

  // ── Entertainment ─────────────────────────────────────────────────────────────

  // ── Arts & Culture ─────────────────────────────────────────────────────────────

  // ── Lifestyle ──────────────────────────────────────────────────────────────────

  // ── Media ───────────────────────────────────────────────────────────────────────

  // ── Education ─────────────────────────────────────────────────────────────────────

  // ── Ideas & Opinion ──────────────────────────────────────────────────────────────
};

export function getTopicDescription(slug) {
  return TOPIC_DESCRIPTIONS[slug] || '';
}
