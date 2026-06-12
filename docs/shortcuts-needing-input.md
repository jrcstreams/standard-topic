# Shortcuts that require user input (review)

_Auto-scanned from `data/shortcuts*.json`. **23 flagged** — they can't be fulfilled by one-tap submit because they either ask the user questions first or contain `[bracket]` blanks the user must fill in. (`{topic}`/`{query}` tokens ARE auto-filled by the app, so those are not flagged.)_

For each, mark: **DELETE** · **REWRITE** to stand alone · **KEEP**.


## Bucket A — ask the user questions first  (9)

_The prompt explicitly interviews the user before answering. Recommend **DELETE** or rewrite to assume sensible defaults._

| # | Shortcut | id | group | Why flagged |
|---|----------|----|-------|-------------|
| 1 | **How This Affects Me** | `how-this-affects-me` | analyze | asks the user questions first |
| 2 | **Budget Analysis** | `budget-analysis` | topic-specific | asks the user questions first |
| 3 | **Help Me Pick Software** | `help-pick-software` | topic-specific | asks the user questions first; placeholder(s): `[function — CRM, project management, etc.]` |
| 4 | **Build My Workout Routine** | `build-my-workout-routine` | topic-specific | asks the user questions first |
| 5 | **Endurance Training Plan** | `endurance-training-plan` | topic-specific | asks the user questions first; placeholder(s): `[event or goal]` |
| 6 | **Build My Eating Plan** | `build-my-eating-plan` | topic-specific | asks the user questions first; placeholder(s): `[goal — fat loss, muscle gain, performance, gen]` |
| 7 | **What Should I Play Right Now** | `gaming-what-should-i-play` | topic-specific | asks the user questions first |
| 8 | **What Should I Read Next** | `books-what-should-i-read-next` | topic-specific | asks the user questions first |
| 9 | **Build My Learning Plan** | `build-my-learning-plan` | topic-specific | asks the user questions first; placeholder(s): `[topic or skill]` |

<details><summary>Full prompts</summary>


**How This Affects Me** (`how-this-affects-me`)  
> Help me understand how the topic of {TOPIC} affects me personally. Ask me a few questions about my situation if needed, then walk me through the practical implications — what I should pay attention to, what decisions might be affected, and what I can do about it.


**Budget Analysis** (`budget-analysis`)  
> Help me build a working budget from the ground up. Ask about my take-home income, fixed expenses, variable spending, debts, and what I'm saving toward. Then recommend a framework that fits (50/30/20, zero-based, etc.), build the line-item budget in a clean table, flag where the numbers look unrealistic, and suggest a tracking method and review cadence that will keep it alive past month one.


**Help Me Pick Software** (`help-pick-software`)  
> Help me pick software for [function — CRM, project management, etc.]. Ask about my company size, budget, key needs, and existing stack — then recommend specific options with reasoning.


**Build My Workout Routine** (`build-my-workout-routine`)  
> Help me build an effective workout routine. Ask me about my goals (strength, hypertrophy, endurance, general fitness), available equipment, time per week, and experience level — then build a program that fits.


**Endurance Training Plan** (`endurance-training-plan`)  
> Help me build an endurance training plan for [event or goal]. Ask about my current level, timeline, and constraints — then map out a periodization with specific weekly structure.


**Build My Eating Plan** (`build-my-eating-plan`)  
> Help me build an eating plan for [goal — fat loss, muscle gain, performance, general health]. Ask about my preferences, schedule, cooking ability, and constraints — then suggest an evidence-based approach.


**What Should I Play Right Now** (`gaming-what-should-i-play`)  
> Help me find what to play. Ask me about platforms, genres I like, time per session, and recent games I've enjoyed — then recommend a few well-reasoned options.


**What Should I Read Next** (`books-what-should-i-read-next`)  
> Help me find what to read next. Ask about my recent favorites, mood I'm in, fiction vs. nonfiction preference, and length tolerance — then recommend a few well-reasoned options.


**Build My Learning Plan** (`build-my-learning-plan`)  
> Help me build a learning plan for [topic or skill]. Ask about my current level, goals, time available, and learning style — then map out a structured path with specific resources.

</details>


## Bucket B — `[bracket]` blanks the user must fill  (14)

_An empty placeholder the app does NOT auto-fill. Recommend **REWRITE** to a topic-driven version (e.g. "Explain [court case]" -> "Explain a notable court case in {topic} right now") or **DELETE**._

| # | Shortcut | id | group | Why flagged |
|---|----------|----|-------|-------------|
| 1 | **Best AI Tool for My Use Case** | `best-ai-tool-use-case` | topic-specific | placeholder(s): `[use case — writing, coding, research, image ge]` |
| 2 | **AI Compliance Help by Sector** | `ai-compliance-help-by-sector` | topic-specific | placeholder(s): `[sector — healthcare, finance, employment, educ]` |
| 3 | **Threat Briefing for My Sector** | `threat-briefing-for-sector` | topic-specific | placeholder(s): `[sector — healthcare, finance, manufacturing, r]` |
| 4 | **Health Condition Primer** | `health-condition-primer` | topic-specific | placeholder(s): `[health condition]` |
| 5 | **Training as I Age** | `training-as-i-age` | topic-specific | placeholder(s): `[age range]` |
| 6 | **Explain This Court Case** | `explain-this-case` | topic-specific | placeholder(s): `[court case]` |
| 7 | **Country Deep Dive** | `country-deep-dive` | topic-specific | placeholder(s): `[country]` |
| 8 | **African Country Deep Dive** | `african-country-deep-dive` | topic-specific | placeholder(s): `[African country]` |
| 9 | **Club Deep Dive** | `soccer-club-deep-dive` | topic-specific | placeholder(s): `[soccer club]` |
| 10 | **Team Deep Dive** | `ncaab-team-deep-dive` | topic-specific | placeholder(s): `[school name]` |
| 11 | **Genre Spotlight** | `music-genre-spotlight` | topic-specific | placeholder(s): `[genre]` |
| 12 | **Genre Deep Dive** | `books-genre-deep-dive` | topic-specific | placeholder(s): `[genre — literary fiction, sci-fi/fantasy, roma]` |
| 13 | **Backlist Worth Reading** | `books-backlist-worth-reading` | topic-specific | placeholder(s): `[category or theme]` |
| 14 | **Institution Deep Dive** | `institution-deep-dive` | topic-specific | placeholder(s): `[institution]` |

<details><summary>Full prompts</summary>


**Best AI Tool for My Use Case** (`best-ai-tool-use-case`)  
> Help me pick the best AI tool for [use case — writing, coding, research, image generation, video, voice, agents, etc.]. Cover the leading options, what each does best, pricing, and how to choose based on what I'm trying to do.


**AI Compliance Help by Sector** (`ai-compliance-help-by-sector`)  
> Walk me through the AI compliance landscape for [sector — healthcare, finance, employment, education, etc.]. Cover the relevant regulations, key obligations, recent enforcement, and what an organization in this sector should be doing.


**Threat Briefing for My Sector** (`threat-briefing-for-sector`)  
> Give me a current threat briefing for [sector — healthcare, finance, manufacturing, retail, government, etc.]. Cover the active threat actors, common attack patterns, regulatory requirements, and where to focus defenses.


**Health Condition Primer** (`health-condition-primer`)  
> Give me a current overview of [health condition]. Cover what it is, prevalence, risk factors, current standard of care, the most promising research directions, and reliable sources for further learning.


**Training as I Age** (`training-as-i-age`)  
> Give me guidance on how to train at [age range]. Cover what's most important to prioritize at this stage, common mistakes, and how to maintain long-term progress.


**Explain This Court Case** (`explain-this-case`)  
> Walk me through [court case]. Cover the underlying facts, the legal questions, the arguments on each side, the court's ruling (if decided) or expected timing (if pending), and the broader implications.


**Country Deep Dive** (`country-deep-dive`)  
> Give me a current overview of [country]. Cover the political situation, economy, security environment, key recent developments, foreign policy posture, and how it fits into its region and the wider world.


**African Country Deep Dive** (`african-country-deep-dive`)  
> Give me a current overview of [African country]. Cover political situation, economy, security, key issues, and how it fits into regional dynamics.


**Club Deep Dive** (`soccer-club-deep-dive`)  
> Give me a current snapshot of [soccer club]. Cover league position, recent form, key players, manager situation, transfer activity, and outlook for the season.


**Team Deep Dive** (`ncaab-team-deep-dive`)  
> Give me a current snapshot of [school name] college basketball team. Cover record, ranking, key players, recent performance, and tournament outlook.


**Genre Spotlight** (`music-genre-spotlight`)  
> Give me a current snapshot of [genre]. Cover the dominant artists, biggest recent releases, emerging acts, and where the genre is heading.


**Genre Deep Dive** (`books-genre-deep-dive`)  
> Give me a current snapshot of [genre — literary fiction, sci-fi/fantasy, romance, thriller, memoir, history, business, etc.]. Cover the dominant authors, recent standouts, and where the genre is heading.


**Backlist Worth Reading** (`books-backlist-worth-reading`)  
> What are great older books in [category or theme] worth reading now? Recommend books that have aged well or feel especially relevant today, with reasoning for each pick.


**Institution Deep Dive** (`institution-deep-dive`)  
> Give me a current overview of [institution]. Cover its position and reputation, recent stories and controversies, financial health, leadership, and what's distinctive about it right now.

</details>
