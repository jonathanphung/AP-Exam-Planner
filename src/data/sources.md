# Data sources for `ap-2026.json`

Every value in `ap-2026.json` was taken from a College Board page fetched on
**2026-07-04** (the file's `lastVerified` date). Nothing is estimated; any
value College Board has not published is the literal string `"pending"`
(PRD §7.5/§8/§11).

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
    → 130). The `questionCount` type also accepts a published range string
    (`"55–75"`) for cycles where College Board prints an adaptive range, though
    **no subject currently uses one** after the 2026-07-09 re-source — see
    "2026 digital-redesign question-count corrections" below, which moved AP
    Chinese and AP Japanese to fixed counts.
- Portfolio component weights (`weightPct`):
  - AP Seminar 20% + 35% = 55% through-course performance tasks:
    <https://apcentral.collegeboard.org/courses/ap-seminar/exam>
  - AP Research 100% through-course performance task:
    <https://apcentral.collegeboard.org/courses/ap-research/exam>
  - AP CSP Create performance task + written responses 30%:
    <https://apcentral.collegeboard.org/courses/ap-computer-science-principles/exam>
  - AP Art and Design sustained investigation 60% + selected works 40%:
    <https://apstudents.collegeboard.org/courses/ap-drawing/assessment>

## 2026 digital-redesign question-count corrections (issue #45, re-sourced 2026-07-09)

The initial 2026-07-04 fill carried **pre-redesign** question counts for seven
subjects. They were re-sourced on **2026-07-09** from each course's AP Central
exam page (`https://apcentral.collegeboard.org/courses/ap-<slug>/exam`),
adversarially verified (one fetch agent + one independent refute-skeptic per
subject), and re-checked by hand. Verbatim page text for all 42 subjects is
committed under `docs/super-board/research/collegeboard-2026/` (see that
folder's `README.md`); each subject below cites its file.

| subject | field | was | now | verbatim source quote |
|---|---|---|---|---|
| `statistics` | `mcqCount` | 40 | **42** | "Section I: Multiple Choice — 42 Questions \| 1 Hour 30 Minutes \| 50% of Exam Score" |
| `statistics` | `frqCount` | 6 | **4** | "Section II: Free Response — 4 Questions \| 1 Hour 30 Minutes \| 50% of Exam Score" |
| `french-language-and-culture` | `mcqCount` | 65 | **55** | "Section II: Multiple-Choice — 55 Questions \| 80 Minutes \| 50% of Score" |
| `french-language-and-culture` | `frqCount` | 4 | **3** | "Section I: Free-Response — 3 Questions \| 65–70 Minutes \| 50% of Score" |
| `german-language-and-culture` | `mcqCount` | 65 | **55** | "Section II: Multiple-Choice — 55 Questions \| 80 Minutes \| 50% of Score" |
| `german-language-and-culture` | `frqCount` | 4 | **3** | "Section I: Free-Response — 3 Questions \| 65–70 Minutes \| 50% of Score" |
| `italian-language-and-culture` | `mcqCount` | 65 | **55** | "55 Questions \| 80 Minutes \| 50% of Score" |
| `italian-language-and-culture` | `frqCount` | 4 | **3** | "3 Questions \| 65–70 Minutes \| 50% of Score" |
| `spanish-language-and-culture` | `mcqCount` | 65 | **55** | "Section II: Multiple-Choice — 55 Questions \| 80 Minutes \| 50% of Score" |
| `spanish-language-and-culture` | `frqCount` | 4 | **3** | "Section I: Free-Response — 3 Questions \| 65–70 Minutes \| 50% of Score" |
| `chinese-language-and-culture` | `mcqCount` | `"55–75"` | **55** | "Section II: Multiple-Choice — 55 Questions \| 65 Minutes \| 50% of Score" |
| `japanese-language-and-culture` | `mcqCount` | `"60–75"` | **55** | "Section II: Multiple Choice — 55 questions — 50% of Score (Part A: Listening 25 + Part B: Reading 30)" |

The `"55–75"` / `"60–75"` ranges for Chinese and Japanese described the older
adaptive-listening format; the current pages print a fixed **55** (25 listening
+ 30 reading). AP Statistics moved to 42 MCQ / 4 FRQ and AP French/German/
Italian/Spanish now open with a spoken project presentation, dropping Section I
to 3 free-response questions.

### `frqType` re-descriptions (kept consistent with the corrected `frqCount`)

`frqType` renders directly beneath `frqCount` in `InfoPanel`, so a corrected
count with a stale description would render a self-contradiction. Where the
count changed, `frqType` was re-sourced from the same page:

- `french/german/italian/spanish-language-and-culture`: `"2 written tasks + 2
  spoken tasks"` → **`"1 written task + 2 spoken tasks"`** — the three published
  free-response questions are Project Presentation (spoken), Project Q&A
  (spoken), and Argumentative Essay (written).
- `statistics`: `"6 free-response questions (5 multipart questions + 1
  investigative task)"` → **`"pending"`** — the page prints only "Section II:
  Free Response — 4 Questions" with no published breakdown of the four, so no
  composition can be asserted under the hard data rule.
- `chinese/japanese-language-and-culture`: unchanged — `frqCount` stays 4 and
  the four questions remain 2 spoken (Presentation, Q&A) + 2 written (Story
  Narration, Email Response), so `"2 written tasks + 2 spoken tasks"` is correct.

### `french-language-and-culture.totalMinutes` → `"pending"`, and its siblings

The dataset shipped `totalMinutes: 180` for French, **a figure the exam page
does not print anywhere** ("The page does not print an overall total exam
duration" — `french-language-and-culture.json`). Its published sections sum to
~145–150 minutes, and summing published sub-values into an unprinted parent is
the same forbidden class as back-computing (PRD §7.5/§8/§11). It is now the
literal `"pending"`. A `"pending"` total already renders as the "Pending" badge
(`InfoPanel`), falls back to a default calendar block (`calendar.ts`), and emits
no `DTEND` (`ics.ts`) — so the correction only stops asserting an unsourced
duration.

The same unprinted-total defect exists for the five sibling language exams this
card already touches; the provenance's `datasetDiscrepancies` flags each, and
they are corrected to `"pending"` here for internal consistency (French cannot
read "Pending" while a structurally identical sibling reads a fabricated
duration):

- `german-language-and-culture`: was 183 — "The page prints no combined total
  exam time; Section II = 80 Minutes, Section I = 65–70 Minutes."
- `italian-language-and-culture`: was 180 — "does not print an overall exam
  total."
- `spanish-language-and-culture`: was 183 — "The page prints no single total
  exam time."
- `chinese-language-and-culture`: was 120 — "The page does not print a total
  exam time; only per-section times are stated."
- `japanese-language-and-culture`: was 120 — the Exam Components block prints no
  total; the only published figure is the Exam Overview PDF's *approximate*
  "two hours and 15 minutes ... includ[ing] a 10-minute break," which the hard
  data rule bars from being asserted as an exact `totalMinutes`.

`statistics.totalMinutes` was **left at 180**: its `datasetDiscrepancies` does
not flag it, and both 90-minute sections are individually published.

### Scope deliberately held to these seven subjects

Two categories were **intentionally not touched** here:

1. **The seven 3+-section subjects** — `african-american-studies`,
   `european-history`, `united-states-history`, `world-history-modern`,
   `music-theory`, `spanish-literature-and-culture`,
   `business-with-personal-finance`. Their provenance shows separately-timed
   Part A/B or third sections (e.g. Music Theory free response "7 + 2", US
   History free response "2"), which the flat `mcqCount`/`frqCount` model
   cannot express. That is issue #44's `sections[]` work, not a count fix —
   forcing a flat number here would fabricate an aggregate the page never
   prints. Left unchanged.
2. **Other subjects' unsourced durations** — the provenance also flags
   `microeconomics.totalMinutes` (130, "not printed") and
   `psychology.totalMinutes` (160, "pending"), plus many per-section
   `mcqMinutes`/`frqMinutes` values absent from the flat schema. These are
   outside this card's seven-subject remit and belong to #44's duration model.
   Recorded here so they are not lost.

### Design decision — keep the range type in `questionCount`

After these corrections **no subject uses a range** for `mcqCount`/`frqCount`
(Chinese and Japanese moved to the fixed 55). The `questionCount` union in
`schema.ts` still accepts a published range string (`/^\d+–\d+$/`). It is
**kept**, not removed: (a) the issue constrains this card to "no schema change";
(b) College Board has printed adaptive ranges before and may again in a future
cycle, so retaining the type keeps the model able to represent a published range
without a schema migration. The data test below pins the seven counts as exact
integers so a future re-source cannot silently regress them back to a range.

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
