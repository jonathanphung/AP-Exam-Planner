# Data sources for `ap-2026.json`

Every value in `ap-2026.json` was taken from a College Board page fetched on
**2026-07-04** (the file's `lastVerified` date), except the per-section
durations (`mcqMinutes` / `frqMinutes`, added for issue #38) which were fetched
on **2026-07-08** — see "Per-section timing (`mcqMinutes` / `frqMinutes`)"
below. Nothing is estimated; any value College Board has not published is the
literal string `"pending"` (PRD §7.5/§8/§11).

## The four data classes (issue #2 AC)

| Data class | Exact URL used |
|---|---|
| Exam calendar (regular dates + AM/PM sessions + session start times) | <https://apcentral.collegeboard.org/exam-administration-ordering-scores/exam-dates> |
| Late-testing calendar | <https://apcentral.collegeboard.org/exam-administration-ordering-scores/exam-dates/late-testing-dates> |
| Portfolio deadlines | <https://apcentral.collegeboard.org/about-ap/ap-coordinators/calendar-deadlines> (Apr 30, 2026 11:59 p.m. ET for AP Seminar / AP Research / AP CSP performance tasks; May 8, 2026 8 p.m. ET for AP Art and Design portfolios — the Art and Design deadline is also stated on the exam-dates page above) |
| Score distributions (pass rates) | <https://apstudents.collegeboard.org/about-ap-scores/score-distributions> |

### Notes on the score distributions

The issue expected the 2025 administration to be the most recent published
data. As of 2026-07-04 College Board's score-distributions page already
carries the **2026 administration** results for all subjects (released on a
rolling basis in July 2026), so `passRate` is the published "3+" percentage
from the 2026 tables — the most recent published data, per the AC. The two
Career Kickstart courses have no administrations yet and are `"pending"`.

## Session start times

The exam-calendar tables label sessions "Morning 8 a.m. Local Time" and
"Afternoon 12 p.m. Local Time"; the same page states exams must begin between
8–9 a.m. / 12–1 p.m. local time. `sessionStartTimes` records the published
labels verbatim.

## Exam format, delivery mode, and calculator policy (per-subject)

- Delivery mode (fully digital / hybrid / not delivered through Bluebook):
  <https://apcentral.collegeboard.org/exam-administration-ordering-scores/administering-exams/digital-ap-exams/exam-modes>
  - "digital" = fully digital in Bluebook, portfolio-only subjects submitted
    through the AP Digital Portfolio, and the AP Chinese/Japanese exams
    (administered on school devices through a separate exam application).
  - "hybrid" = MCQ in Bluebook + handwritten free response.
  - "paper" = paper exam booklets (French/German/Italian/Spanish Language,
    Music Theory, Spanish Literature), per the same page.
- Calculator policy (which exams allow calculators; all others prohibit them):
  <https://apstudents.collegeboard.org/exam-policies-guidelines/calculator-policies>
- Question counts, section timing, and exam duration: each course's official
  pages, fetched per subject —
  - AP Central "Exam" pages: `https://apcentral.collegeboard.org/courses/<slug>/exam`
    (e.g. `ap-biology`, `ap-calculus-ab`, `ap-physics-1`, `ap-world-history`,
    `ap-seminar`, `ap-research`)
  - AP Students "Assessment" pages (published "Exam Duration" and exam-date
    cross-check): `https://apstudents.collegeboard.org/courses/<slug>/assessment`
    (e.g. `ap-biology`, `ap-music-theory`, `ap-cybersecurity`,
    `ap-business-personal-finance`)
  - `totalMinutes` is the published "Exam Duration" from the AP Students
    assessment page (e.g. Biology "3hrs" → 180; Cybersecurity "2hrs 10mins"
    → 130). Where the page publishes a range for question counts (AP Chinese
    "25–35" + "30–40" listening/reading MCQs), the dataset stores the
    published range as a string (e.g. `"55–75"`).
### Per-section timing (`mcqMinutes` / `frqMinutes`)

Added for issue #38 (ICS export timing breakdown). Each value is the published
duration of that exam section, fetched **2026-07-08** from the AP Students
assessment page for the course
(`https://apstudents.collegeboard.org/courses/ap-<slug>/assessment`, the same
pages already cited above for `totalMinutes`). **No section duration is
estimated**, and none is back-computed by subtracting one section from the
published total — an unpublished section duration is the literal `"pending"`
(PRD §7.5/§8/§11).

Each populated value was cross-checked against the section's already-verified
question count and against the published `totalMinutes`; a value was only
recorded when the fetched page unambiguously stated a single time for exactly
that section AND its question count matched the dataset. Where a page did not
survive that check the field is `"pending"` rather than a guess.

Fully populated (both sections stated and cross-checked; `mcqMinutes` +
`frqMinutes` = published `totalMinutes`):

| Subject | MCQ | FRQ | Total | Assessment page section text (verbatim) |
|---|---|---|---|---|
| biology | 90 | 90 | 180 | MC "60 questions 1hr 30mins"; FR "6 questions 1hr 30mins" |
| calculus-bc | 105 | 90 | 195 | MC "45 questions 1hr 45mins"; FR "6 questions 1hr 30mins" |
| chemistry | 90 | 105 | 195 | MC "60 questions 1hr 30mins"; FR "7 questions 1hr 45mins" |
| physics-1 | 80 | 100 | 180 | MC "40 Questions 1hr 20mins"; FR "4 Questions 1hr 40mins" |
| physics-2 | 80 | 100 | 180 | MC "40 Questions 1hr 20mins"; FR "4 Questions 1hr 40mins" |
| physics-c-mechanics | 80 | 100 | 180 | MC "40 Questions 1hr 20mins"; FR "4 Questions 1hr 40mins" |
| physics-c-electricity-and-magnetism | 80 | 100 | 180 | MC "40 Questions 1hr 20mins"; FR "4 Questions 1hr 40mins" |
| precalculus | 120 | 60 | 180 | MC "40 Questions 2hrs"; FR "4 Questions 1hr" |
| environmental-science | 90 | 70 | 160 | MC "80 questions 1hr 30mins"; FR "3 questions 1hr 10mins" |
| psychology | 90 | 70 | 160 | MC "75 questions 1hr 30mins"; FR "2 questions 1hr 10mins" |
| human-geography | 60 | 75 | 135 | MC "60 questions 1hr"; FR "3 questions 1hr 15mins" |
| macroeconomics | 70 | 60 | 130 | MC "60 Questions 1hr 10mins"; FR "3 Questions 1hr" |
| microeconomics | 70 | 60 | 130 | MC "60 questions 1hr 10mins"; FR "3 questions 1hr" |
| comparative-government-and-politics | 60 | 90 | 150 | MC "55 questions 1hr"; FR "4 questions 1hr 30mins" |
| united-states-government-and-politics | 80 | 100 | 180 | MC "55 questions 1hr 20mins"; FR "4 questions 1hr 40mins" |
| computer-science-principles | 120 | 60 | 180 | MC "70 questions 120 minutes"; exam-day written response "2 questions 60 minutes" |
| latin | 65 | 115 | 180 | MC "52 questions 1hr 05mins"; FR "5 questions 1hr 55mins" |

Partially populated — one section is directly published, the other is
`"pending"` because the exam's Part A / Part B structure spreads it across
sections and College Board publishes only per-part times (never summed here):

- `united-states-history`, `world-history-modern`: `mcqMinutes: 55` (Section I
  Part A: "55 questions 55mins"); `frqMinutes: "pending"` (short-answer +
  document-based + long essay are timed as separate parts across Sections I–II).
- `african-american-studies`: `mcqMinutes: 70` (Section I: "60 Questions
  1hr 10mins"); `frqMinutes: "pending"` (project-validation, short-answer, and
  document-based questions are timed as separate parts).
- `english-language-and-composition`: `frqMinutes: 135` (Section II free
  response: "2 hour and 15 minute time limit ... includes a 15-minute reading
  period"); `mcqMinutes: "pending"` (the MC section time is not stated on the
  page).
- `seminar`: `frqMinutes: 120` (end-of-course written exam, "2hrs", four
  free-response questions); `mcqMinutes: "pending"` (no MC section — `mcqCount`
  is 0, so the ICS breakdown omits the MCQ row entirely).

`"pending"` for both sections, with the reason:

- Page states `totalMinutes` but not the per-section split (as fetched):
  `calculus-ab`, `computer-science-a`, `art-history`, `european-history`,
  `english-literature-and-composition`, `music-theory`.
- Fetched section text disagreed with the dataset's verified question counts,
  so it was not trusted (cross-check failed): `statistics`,
  `spanish-language-and-culture`, `french-language-and-culture`.
- World-language / range-count exams whose listening + reading + speaking +
  writing structure does not map to a single MCQ time + single FRQ time:
  `german-language-and-culture`, `italian-language-and-culture`,
  `spanish-literature-and-culture`, `chinese-language-and-culture`,
  `japanese-language-and-culture`.
- No May 2026 exam, so section durations never render in the export: the two
  Career Kickstart courses (`business-with-personal-finance`, `cybersecurity`)
  and the portfolio-only courses (`research`, `2-d-art-and-design`,
  `3-d-art-and-design`, `drawing`).

Note on `Total Length` vs the section sum: the ICS breakdown prints the
published `totalMinutes`, not the sum of `mcqMinutes` + `frqMinutes`. For the
fully-populated subjects above the two happen to agree, but the total is
authoritative — some exams' published total excludes breaks/instructions, and
those are not reconciled by editing section values.

- Portfolio component weights (`weightPct`):
  - AP Seminar 20% + 35% = 55% through-course performance tasks:
    <https://apcentral.collegeboard.org/courses/ap-seminar/exam>
  - AP Research 100% through-course performance task:
    <https://apcentral.collegeboard.org/courses/ap-research/exam>
  - AP CSP Create performance task + written responses 30%:
    <https://apcentral.collegeboard.org/courses/ap-computer-science-principles/exam>
  - AP Art and Design sustained investigation 60% + selected works 40%:
    <https://apstudents.collegeboard.org/courses/ap-drawing/assessment>

## Course list (42 subjects, including Career Kickstart)

<https://apstudents.collegeboard.org/course-index-page> — "Find course and
exam information for 42 AP subjects." The list includes the two AP Career
Kickstart courses (AP Business with Personal Finance, AP Cybersecurity).

### Career Kickstart courses have no May 2026 exam

Both courses' assessment pages state: "Note: The 2027 AP Exam dates will be
available in summer 2026" — their first end-of-course exams are in May 2027
(<https://apstudents.collegeboard.org/courses/ap-cybersecurity/assessment>,
<https://apstudents.collegeboard.org/courses/ap-business-personal-finance/assessment>).
They are therefore listed with `exam: null`, `lateTesting: null`, a sourced
`noExamReason`, and `passRate: "pending"`. Their published exam formats (for
the 2027 first administration) are included as College Board publishes them
today.

## Official course/exam pages (issue #22 — Tier 3 links)

The UI links each subject to its official College Board page from
`src/lib/college-board-links.ts` (the single source of truth for these URLs —
no scattered hardcoded strings). The pattern is
`https://apcentral.collegeboard.org/courses/ap-<id>/exam`, where `<id>` is the
dataset subject id. **Every linked URL was individually verified with an
HTTP request on 2026-07-07**: 37 of the 42 subjects returned 200 from the
patterned URL (including AP Cybersecurity, whose exam page exists ahead of
its May 2027 first administration). Five subjects do not follow the pattern
and carry an individually verified exception URL instead:

| Subject id | Verified official page | Why the pattern fails |
|---|---|---|
| `business-with-personal-finance` | <https://apcentral.collegeboard.org/courses/ap-business-personal-finance/exam> | College Board's slug drops "with" |
| `world-history-modern` | <https://apcentral.collegeboard.org/courses/ap-world-history/exam> | official page has no "-modern" suffix |
| `2-d-art-and-design` | <https://apcentral.collegeboard.org/courses/ap-2-d-art-and-design/portfolio> | portfolio-only course — no `/exam` page |
| `3-d-art-and-design` | <https://apcentral.collegeboard.org/courses/ap-3-d-art-and-design/portfolio> | portfolio-only course — no `/exam` page |
| `drawing` | <https://apcentral.collegeboard.org/courses/ap-drawing/portfolio> | portfolio-only course — no `/exam` page |

Per the data rule, an unverifiable link is omitted (the helper returns
`null`), never guessed. A unit test (`src/lib/college-board-links.test.ts`)
pins full coverage for every shipped subject, so an id added to a future
dataset without re-verification fails CI instead of shipping a guessed link.

## Annual swap (PRD §8)

The May 2027 calendar is unpublished — no 2027 dates are projected anywhere
in the dataset. When College Board posts the 2027 schedule (summer 2026),
swap this JSON for a new `ap-2027.json` and update the window constants in
`schema.ts`.
