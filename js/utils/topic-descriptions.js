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
  'banking': 'Banks, lending, regulation, and the institutions that move money.',
  'cryptocurrency': 'Bitcoin, tokens, exchanges, and the evolving crypto economy.',
  'deals-ma': 'Mergers, acquisitions, and the dealmaking reshaping industries.',
  'economy': 'Growth, inflation, jobs, and the forces driving the broader economy.',
  'energy-commodities': 'Oil, gas, metals, and the markets for the world’s raw materials.',
  'fintech': 'Payments, neobanks, and the technology rewiring financial services.',
  'housing-real-estate': 'Home prices, mortgages, and the commercial property market.',
  'jobs-labor': 'Hiring, wages, unions, and the changing world of work.',
  'markets': 'Stocks, bonds, and the daily moves across global financial markets.',
  'personal-finance': 'Saving, investing, and managing your own money smarter.',
  'small-business': 'Founders, Main Street, and the realities of running a small business.',

  // ── Technology ──────────────────────────────────────────────────────────────
  'artificial-intelligence': 'Models, research, and the products built on modern AI.',
  'ai-governance-policy': 'Regulation, safety, and the rules taking shape around AI.',
  'blockchain-web3': 'Decentralized apps, tokens, and the infrastructure behind Web3.',
  'cloud-computing': 'Cloud platforms, infrastructure, and the data centers powering them.',
  'consumer-electronics': 'Phones, laptops, wearables, and the latest consumer hardware.',
  'cybersecurity': 'Breaches, threats, and the fight to keep systems and data secure.',
  'data-analytics': 'Big data, analytics, and turning information into insight.',
  'emerging-technologies': 'Quantum, AR/VR, and the frontier tech that’s next.',
  'privacy-data-protection': 'Surveillance, data rights, and the battle over personal privacy.',
  'programming-development': 'Languages, tools, and the craft of building software.',
  'robotics-automation': 'Robots, automation, and machines taking on new tasks.',
  'social-media': 'Platforms, creators, and how we connect and share online.',
  'software-saas': 'Apps, SaaS, and the software businesses run on.',
  'startups-venture-capital': 'Founders, funding rounds, and the startup ecosystem.',

  // ── Science ─────────────────────────────────────────────────────────────────
  'astronomy-space': 'Missions, telescopes, and discoveries across space and the cosmos.',
  'chemistry-biology-genetics': 'Genetics, chemistry, and the biology of living systems.',
  'physics': 'Particles, forces, and the research probing how the universe works.',
  'research-academia': 'Studies, funding, and the people advancing scientific knowledge.',

  // ── Health & Wellness ───────────────────────────────────────────────────────
  'fitness-exercise': 'Training, movement, and the science of staying fit.',
  'healthcare-industry': 'Hospitals, insurers, and the business of delivering care.',
  'nutrition-diet': 'Food, diet, and what the evidence says about eating well.',
  'medical-research-pharma-biotech': 'Drug discovery, biotech, and breakthroughs in medicine.',
  'public-health': 'Disease, prevention, and the health of whole populations.',

  // ── Politics ────────────────────────────────────────────────────────────────
  'campaigns-elections': 'Candidates, polling, and the races shaping who governs.',
  'congress-white-house': 'Legislation, the presidency, and the workings of Washington.',
  'courts-law-regulation': 'Courts, rulings, and the laws and regulations that bind us.',
  'defense-national-security-foreign-policy': 'Defense, security, and how nations project power abroad.',
  'geopolitics': 'Alliances, rivalries, and the global contest for influence.',
  'us-politics': 'The parties, players, and fights driving American politics.',

  // ── World ───────────────────────────────────────────────────────────────────
  'africa': 'News and developments from across the African continent.',
  'asia': 'Politics, economics, and culture across Asia.',
  'canada': 'Politics, business, and news from Canada.',
  'china': 'Beijing’s politics, economy, and role on the world stage.',
  'us': 'National news and developments from across the United States.',
  'europe': 'Politics, the economy, and affairs across Europe.',
  'india': 'Politics, business, and news from India.',
  'latin-america': 'News and developments across Latin America.',
  'middle-east': 'Conflict, diplomacy, and developments across the Middle East.',
  'oceania': 'News from Australia, New Zealand, and the Pacific.',
  'russia-eastern-europe': 'Russia, the war, and developments across Eastern Europe.',

  // ── Sports ──────────────────────────────────────────────────────────────────
  'soccer': 'Matches, transfers, and storylines from world soccer.',
  'mlb': 'Scores, trades, and the season across Major League Baseball.',
  'nba': 'Games, trades, and the storylines driving the NBA.',
  'nfl': 'Games, trades, and the week-to-week drama of the NFL.',
  'nhl': 'Scores, trades, and the season across the NHL.',
  'college-basketball': 'Rankings, rivalries, and the road through college basketball.',
  'college-football': 'Rankings, rivalries, and the college football season.',
  'combat-sports': 'Boxing, MMA, and the biggest fights and fighters.',

  // ── Climate & Environment ─────────────────────────────────────────────────────
  'conservation-wildlife': 'Wildlife, ecosystems, and the work to protect them.',
  'clean-energy-sustainability': 'Renewables, sustainability, and the shift to clean energy.',
  'climate-policy': 'Targets, treaties, and the politics of climate action.',
  'weather': 'Storms, forecasts, and extreme weather events.',

  // ── Entertainment ─────────────────────────────────────────────────────────────
  'celebrities': 'Stars, gossip, and the culture around famous lives.',
  'gaming-streaming': 'Video games, streamers, and the platforms behind play.',
  'television-movies': 'Premieres, box office, and what to watch next.',
  'music': 'Releases, tours, and the artists shaping the charts.',
  'podcasts': 'Shows, hosts, and the world of audio storytelling.',

  // ── Arts & Culture ─────────────────────────────────────────────────────────────
  'architecture-design': 'Buildings, design, and the spaces we live and work in.',
  'books-literature': 'New releases, authors, and the world of books.',
  'fashion-style': 'Runways, trends, and the business of style.',
  'food-dining': 'Restaurants, chefs, and the culture of food.',

  // ── Lifestyle ──────────────────────────────────────────────────────────────────
  'cars-auto': 'New models, EVs, and the world of cars and driving.',
  'home-garden': 'Decor, gardening, and making the most of your space.',
  'relationships': 'Dating, family, and the dynamics of modern relationships.',
  'travel': 'Destinations, tips, and the way we explore the world.',
  'work-careers': 'Careers, the workplace, and getting ahead at work.',

  // ── Media ───────────────────────────────────────────────────────────────────────
  'advertising-marketing': 'Brands, campaigns, and the business of advertising.',
  'journalism': 'Reporting, press freedom, and the practice of journalism.',
  'media-business': 'The companies, deals, and economics behind the media.',

  // ── Education ─────────────────────────────────────────────────────────────────────
  'higher-education': 'Colleges, costs, and the state of higher education.',
  'learning-edtech': 'Edtech, online learning, and new ways to teach.',

  // ── Ideas & Opinion ──────────────────────────────────────────────────────────────
  'ethics-philosophy': 'Ethics, philosophy, and questions about how we should live.',
  'history': 'The past, its lessons, and how we understand history.',
  'religion-faith': 'Faith, belief, and religion’s role in the world.',
};

export function getTopicDescription(slug) {
  return TOPIC_DESCRIPTIONS[slug] || '';
}
