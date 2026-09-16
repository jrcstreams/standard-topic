// One-sentence summaries of what each topic page covers. Shown on the MOBILE
// topic-page hero header only (the desktop layout doesn't display them). Keyed
// by topic slug; getTopicDescription() falls back to '' for unknown slugs.
export const TOPIC_DESCRIPTIONS = {
  // ── Parent topics ──────────────────────────────────────────────────────────
  'world': 'Breaking news, conflicts, and developments from every region of the globe.',
  'politics': 'Elections, policy, the courts, and the people shaping government.',
  'business-finance': 'Markets, deals, the economy, and the companies driving them.',
  'technology': 'AI, startups, gadgets, and the platforms reshaping how we live and work.',
  'sports': 'Scores, trades, and storylines across the leagues and athletes you follow.',
  'science': 'Discoveries and research across space, physics, and the life sciences.',
  'health-wellness': 'Medicine, fitness, nutrition, and the science of living well.',
  'climate-environment': 'Climate policy, clean energy, conservation, and a changing planet.',
  'entertainment': 'Everything happening in movies, TV, music, gaming, and celebrity culture.',
  'arts-culture': 'Books, design, fashion, food, and the wider world of culture.',
  'lifestyle': 'Travel, cars, home, careers, and the way we live day to day.',
  'media': 'The business of journalism, advertising, and the platforms behind the news.',
  'education': 'Schools, higher ed, and the technology changing how we learn.',
  'ideas-opinion-more': 'Big ideas, history, philosophy, faith, and perspectives worth weighing.',

  // ── Business & Finance ──────────────────────────────────────────────────────
  'economy': 'Growth, inflation, jobs, and the forces driving the broader economy.',
  'markets': 'Stocks, bonds, and the daily moves across global financial markets.',

  // ── Technology ──────────────────────────────────────────────────────────────
  'artificial-intelligence': 'Models, research, and the products built on modern AI.',
  'cybersecurity': 'Breaches, threats, and the fight to keep systems and data secure.',
  'social-media': 'Platforms, creators, and how we connect and share online.',

  // ── Science ─────────────────────────────────────────────────────────────────

  // ── Health & Wellness ───────────────────────────────────────────────────────
  'public-health': 'Disease, prevention, and the health of whole populations.',

  // ── Politics ────────────────────────────────────────────────────────────────
  'defense-national-security-foreign-policy': 'Defense, security, and how nations project power abroad.',
  'us-politics': 'The parties, players, and fights driving American politics.',

  // ── World ───────────────────────────────────────────────────────────────────
  'china': 'Beijing’s politics, economy, and role on the world stage.',
  'us': 'National news and developments from across the United States.',

  // ── Sports ──────────────────────────────────────────────────────────────────

  // ── Climate & Environment ─────────────────────────────────────────────────────

  // ── Entertainment ─────────────────────────────────────────────────────────────
  'television-movies': 'Premieres, box office, and what to watch next.',
  'music': 'Releases, tours, and the artists shaping the charts.',

  // ── Arts & Culture ─────────────────────────────────────────────────────────────
  'food-dining': 'Restaurants, chefs, and the culture of food.',

  // ── Lifestyle ──────────────────────────────────────────────────────────────────
  'cars-auto': 'New models, EVs, and the world of cars and driving.',
  'travel': 'Destinations, tips, and the way we explore the world.',

  // ── Media ───────────────────────────────────────────────────────────────────────

  // ── Education ─────────────────────────────────────────────────────────────────────

  // ── Ideas & Opinion ──────────────────────────────────────────────────────────────
};

export function getTopicDescription(slug) {
  return TOPIC_DESCRIPTIONS[slug] || '';
}
