# Data sources for `ap-2027.json`

Every value in `ap-2027.json` was taken from a College Board page fetched on
**2026-07-24** (the file's `lastVerified` date) during the annual dataset swap
(issue #37). Nothing is estimated; any value College Board has not published is
the literal string `"pending"` (PRD §7.5/§8/§11).

**No value was carried over from `ap-2026.json` unverified.** Every subject's
AP Central exam page and AP Students assessment page was re-fetched and diffed
against the 2026 dataset; every difference found is listed under "May 2027
changes" below. The extracted text of every page fetched is committed under
`docs/super-board/research/collegeboard-2027/pages/`, so the claims here are
checkable without re-fetching.

## What happened to `ap-2026.json` (issue #37 AC — decision recorded)

**Deleted, not kept alongside.** The app imports exactly one dataset either
way, so the only question is whether a second file earns its place in the tree.
It does not:

- The full May 2026 file is one `git show cffa1d4:src/data/ap-2026.json` away —
  nothing is lost.
- Its provenance survives in the tree as
  `docs/super-board/research/collegeboard-2026/`, which is the part anyone
  actually re-reads when checking how a value was sourced.
- Leaving a second, superseded dataset next to the live one is how an import
  silently points at last year's calendar. `src/data/cycle.ts` is now the single
  import point; there is one dataset for it to name.

The 2026 test suites moved with the file: `ap-2026.test.ts` /
`ap-2026.qa.test.ts` / `ap-2026.sections.test.ts` are now the `ap-2027.*`
equivalents, retargeted rather than duplicated.

## The four data classes (issue #2 AC)

| Data class | Exact URL used |
|---|---|
| Exam calendar (regular dates + session slots + session start times) | <https://apcentral.collegeboard.org/exam-administration-ordering-scores/exam-dates> — "2027 AP Exam Dates" |
| Late-testing calendar | <https://apcentral.collegeboard.org/exam-administration-ordering-scores/exam-dates/late-testing-dates> — "2027 AP Exam Late-Testing Dates" |
| Portfolio deadlines | <https://apcentral.collegeboard.org/exam-administration-ordering-scores/exam-dates> §"AP Digital Portfolio Submission Deadlines" — Apr 30, 2027 11:59 p.m. ET for AP CSP / AP Seminar / AP Research and (new for 2027) the world-language Personalized Project Reference; May 7, 2027 11:59 p.m. ET for AP Art and Design. Each world-language PPR deadline is additionally printed on that course's own exam page. |
| Score distributions (pass rates) | <https://apstudents.collegeboard.org/about-ap-scores/score-distributions> |

### Why the coordinator calendar is not the portfolio-deadline source this cycle

<https://apcentral.collegeboard.org/about-ap/ap-coordinators/calendar-deadlines>
was the 2026 source. On 2026-07-24 it still publishes the **2025-26** key dates
("AP 2025-26 Key Dates and Deadlines"); the 2026-27 edition is not out yet.
Using it would have shipped 2026 deadlines into a 2027 dataset. The 2027
deadlines come from the 2027 exam-dates page, which publishes all four verbatim.

### Notes on the score distributions

No 2027 administration has happened, so the most recent published distributions
are still the **2026 administration** tables — the same source the 2026 dataset
used. Every `passRate` was re-read from the live tables on 2026-07-24 and
matched the shipped value for all 40 subjects with a published distribution.
The three Career Kickstart courses have no administrations yet and are
`"pending"`.

## Session start times

New for 2027, College Board renamed the slots: "AP Exams are offered as
Session 1 and Session 2 — replacing the former morning and afternoon
designations", and start times now vary by UTC offset
(<https://apcentral.collegeboard.org/exam-administration-ordering-scores/exam-dates/start-times>).
The dataset keeps `AM`/`PM` as its internal slot keys (Session 1 → `AM`,
Session 2 → `PM`) because the published page states that mapping directly:
"Session 1 and Session 2 represent the timeslots that are typically the morning
and afternoon, respectively."

`sessionStartTimes` records the times the page publishes for the majority case,
verbatim: "For most schools, including all schools in the lower 48 United
States, Hawaii, and Washington, D.C., exams still begin at 8 a.m. local time
and 12 p.m. local time." Locations on other UTC offsets have their own published
start times in the table on the start-times page; the app stores no
per-time-zone table because it cannot know which offset a given visitor tests
under, and guessing one would be an invented time.

## May 2027 changes (diffed against `ap-2026.json` on 2026-07-24)

### Calendar

- Regular windows: **May 3–7** and **May 10–14, 2027** (2026: May 4–8, May 11–15).
- Late-testing window: **May 17–21, 2027** (2026: May 18–22).
- Every subject's exam and late-testing slot was re-read from the two 2027
  tables. None was shifted arithmetically from a 2026 date — the 2027 grid
  re-orders subjects as well as moving the week (AP Biology, for example, went
  from Mon May 4 AM to Mon May 3 PM).

### Roster

- **Added: AP Networking** (`networking`). The 2027 schedule lists
  "Networking (2026-27 pilot schools only)" on Fri May 7 Session 2, with late
  testing Mon May 17 Session 1. No AP Central exam page and no AP Students
  assessment page exists for it yet (both 404 on 2026-07-24) — the course is in
  its third and final pilot in 2026-27 and launches in fall 2027 — so its whole
  `format` block is `"pending"` and `examNote` carries the published pilot-only
  restriction. Its official page is the adoption page,
  <https://apcentral.collegeboard.org/courses/ap-networking/adopt>.
- **No course was removed or renamed.** The other 42 ids are unchanged, so no
  saved selection loses a subject in this swap.
- **AP Business with Personal Finance** and **AP Cybersecurity** sit their first
  exams (Tue May 4 and Wed May 5, both Session 1), so their 2026 `noExamReason`
  is gone. No subject carries a `noExamReason` this cycle.

### Exam format

| subject | field | 2026 | 2027 | verbatim 2027 source quote |
|---|---|---|---|---|
| `calculus-ab`, `calculus-bc` | Section I | 45 Q / 105 min (Part A 30 Q/60 min, Part B 15 Q/45 min) | **42 Q / 100 min** (Part A **29 Q/62 min**, Part B **13 Q/38 min**) | "Section I: Multiple Choice / 42 Questions \| 1 Hour 40 Minutes \| 50% of Exam Score"; "Part A: 29 questions; 62 minutes (calculator not permitted)."; "Part B: 13 questions; 38 minutes (graphing calculator required)." |
| `calculus-ab`, `calculus-bc` | `totalMinutes` | 195 | **190** | AP Students "Exam Duration — 3hrs 10mins" |
| `precalculus` | Section I | 40 Q / 120 min (Part A 28 Q/80 min, Part B 12 Q/40 min) | **42 Q / 105 min** (Part A **29 Q/65 min**, Part B **13 Q/40 min**) | "Section I: Multiple Choice / 42 Questions \| 1 Hour and 45 Minutes \| 62.5% of Exam Score" |
| `precalculus` | Section II | 4 Q / 60 min (Part A 30, Part B 30) | **4 Q / 70 min** (Part A **35**, Part B **35**) | "Section II: Free Response / 4 Questions \| 1 Hour and 10 Minutes \| 37.5% of Exam Score" |
| `precalculus` | `totalMinutes` | 180 | **175** | AP Students "Exam Duration — 2hrs 55mins" |
| `physics-1`, `physics-2`, `physics-c-mechanics`, `physics-c-electricity-and-magnetism` | Section I | 40 Q / 80 min | **42 Q / 85 min** | "Section I: Multiple Choice / 42 Questions \| 85 Minutes \| 50% of Exam Score" |
| the same four physics exams | Section II | 4 Q / 100 min | **4 Q / 95 min** | "Section II: Free Response / 4 Questions \| 95 Minutes \| 50% of Exam Score" (`totalMinutes` unchanged at 180 — "3hrs") |

Every other subject's `sections[]`, `totalMinutes`, `questionCount`, and
`weightPercent` re-verified **identical** to the 2026 values.

### Delivery mode

The 2026 source for `delivery` ("AP Exams: How Are They Administered?") is
explicitly scoped to "the 2026 AP Exams" and had not been updated on 2026-07-24,
so it does not speak to the 2027 cycle. Each course's own exam page does, and
several announce a 2027 move:

| subject | 2026 | 2027 | verbatim 2027 source quote |
|---|---|---|---|
| `french-`, `german-`, `italian-`, `spanish-language-and-culture` | `paper` | **`digital`** | "The AP world language and culture courses and exams were revised for the 2026-27 school year. Starting in May 2027, the exams will also transition to a digital exam format in Bluebook." / "This is a fully digital exam." |
| `spanish-literature-and-culture` | `paper` | **`digital`** | "The AP Spanish Literature and Culture Exam will move to a fully digital format in May 2027, with no changes to the exam structure." |
| `music-theory` | `paper` | **`hybrid`** | "Starting in May 2027, the AP Music Theory Exam will move to a hybrid digital format through the Bluebook digital testing app, with no changes to the exam structure." |
| `statistics` | `hybrid` | **`digital`** | "AP Statistics has been revised for the 2026-27 school year…" / "This is a fully digital exam. Students complete multiple-choice and free-response questions in the Bluebook testing app, with all responses automatically submitted at the end of the exam." |

### Calculator policy

`business-with-personal-finance` moved `false` → **`true`**. The 2026 value came
solely from the calculator-policies list, which still omits the Career Kickstart
courses; the course's own exam page states it outright: "Calculators are
permitted for this course's exam. Students can use either a handheld 4-function
calculator or the built-in Desmos 4-function calculator through Bluebook." No
other subject's policy changed.

### Portfolio deadlines

- `computer-science-principles`, `seminar`, `research`: 2026-04-30 →
  **2027-04-30** (11:59 p.m. ET, unchanged cutoff).
- `2-d-art-and-design`, `3-d-art-and-design`, `drawing`: 2026-05-08 (8 p.m. ET)
  → **2027-05-07 (11:59 p.m. ET)** — "AP Art and Design: May 7, 2027 (11:59
  p.m. ET), is the deadline for students to submit their 3 portfolio components
  as final." The cutoff time moved as well as the date, so the note text changed
  too.
- **New:** `chinese-`, `french-`, `german-`, `italian-`,
  `japanese-language-and-culture`, and `spanish-language-and-culture` now carry
  a portfolio entry for the **Personalized Project Reference (PPR)**, due
  **2027-04-30**, 11:59 p.m. ET. `weightPct` is `"pending"`: College Board
  publishes no separate score weight for the PPR itself (it is the reference
  students use during the Project Presentation and Project Q&A questions, which
  are weighted as part of the exam). The deadline is printed on each of those
  six course pages individually ("Fri, Apr 30, 2027 — 11:59 PM ET — Deadline:
  Students Submit Personalized Project Reference (PPR) through the AP Digital
  Portfolio"), so no subject was given one by analogy — notably **AP Latin** and
  **AP Spanish Literature and Culture** publish no PPR deadline and therefore
  have none, even though the exam-dates page's summary line says "AP World
  Languages and Cultures".

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
subject), and re-checked by hand. Verbatim page text for all 43 subjects in the
shipped roster is committed under
`docs/super-board/research/collegeboard-2027/` (see that folder's `README.md`);
each subject below cites its file. The one exception to "exam page" is AP
Networking — no AP Central exam page and no AP Students assessment page exists
for it yet, so its capture is the adoption page
(<https://apcentral.collegeboard.org/courses/ap-networking/adopt>) and its whole
`format` block is `"pending"`.

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

> **Historical (issue #44):** the flat `frqType` field no longer exists — it
> was replaced by `format.sections[]`. For plain two-section exams the
> composition strings below live on as the free-response section's `note`
> (see "Per-section `sections[]` breakdown"); the language exams' structure
> is now expressed by their published parts instead.

`frqType` renders directly beneath `frqCount` in `InfoPanel`, so a corrected
count with a stale description would render a self-contradiction. Where the
count changed, `frqType` was re-sourced from the same page:

- `french/german/italian/spanish-language-and-culture`: `"2 written tasks + 2
  spoken tasks"` → **`"1 written task + 2 spoken tasks"`** — the three published
  free-response questions are Project Presentation (spoken), Project Q&A
  (spoken), and Argumentative Essay (written).
- `statistics`: `"6 free-response questions (5 multipart questions + 1
  investigative task)"` → **`"3 multi-part questions + 1 inference question
  (hypothesis test or confidence interval)"`** — the pre-redesign "investigative
  task" was dropped and the count fell to 4. Both College Board pages publish a
  per-question breakdown of Section II, so the composition is sourced, not
  pending. AP Central
  (`apcentral.collegeboard.org/courses/ap-statistics/exam`): "Question 1:
  Multi-Focus on Practices 1 and 2 / Question 2: Multi-Focus on Practices 3 and
  4 / Question 3: Inference (Hypothesis Test or Confidence Interval) / Question
  4: Multi-Focus on Practices 2, 3, and 4". AP Students
  (`apstudents.collegeboard.org/courses/ap-statistics/assessment`): "Question 1
  is a multi-part question that primarily assesses Practices 1 and 2. Question 2
  is a multi-part question that primarily assesses Practices 3 and 4. Question 3
  focuses on inference, assessing the inference skills associated with Practices
  2, 3, and 4. Question 4 is a multi-part question with a focus on multiple
  course content areas, assessing Practices 2, 3, and 4." Questions 1, 2, and 4
  are the three multi-part / multi-focus questions; Question 3 is the inference
  question. Every term in the stored composition ("multi-part", "inference",
  "hypothesis test or confidence interval") is verbatim page language; the
  redesigned exam prints no "investigative task".
- `chinese/japanese-language-and-culture`: unchanged — `frqCount` stays 4 and
  the four questions remain 2 spoken (Presentation, Q&A) + 2 written (Story
  Narration, Email Response), so `"2 written tasks + 2 spoken tasks"` is correct.

### Exam durations (`totalMinutes`) — AP Central omits the total, AP Students omits section times

The two College Board pages are **complementary**:
`apcentral.collegeboard.org/courses/ap-<slug>/exam` prints each section's timing
and weight but, for most subjects, **no overall exam total**;
`apstudents.collegeboard.org/courses/ap-<slug>/assessment` prints the overall
**`Exam Duration`** but **no per-section times**. A duration absent from AP
Central is therefore *not* unpublished — it is on AP Students. `totalMinutes` is
sourced from the AP Students `Exam Duration`; the per-section splits come from AP
Central. (Recorded because the first re-source consulted only AP Central,
mislabelled published totals `"pending"`, and this card's first build then
overwrote four correct durations with that false `"pending"`. The provenance was
re-sourced and patched at commit `171cb15`; every sit-down subject now carries
`totalMinutesStated` / `totalMinutesVerbatim` / `totalMinutesSource`.)

The six language exams' `totalMinutes` are the published AP Students
`Exam Duration`:

| subject | totalMinutes | AP Students `Exam Duration` (verbatim) | source |
|---|---|---|---|
| `french-language-and-culture` | **150** | "Approximately 2hrs 30mins" | <https://apstudents.collegeboard.org/courses/ap-french-language-and-culture/assessment> |
| `german-language-and-culture` | **150** | "Approximately 2hrs 30mins" | <https://apstudents.collegeboard.org/courses/ap-german-language-and-culture/assessment> |
| `italian-language-and-culture` | **150** | "Approximately 2hrs 30mins" | <https://apstudents.collegeboard.org/courses/ap-italian-language-and-culture/assessment> |
| `spanish-language-and-culture` | **150** | "Approximately 2hrs 30mins" | <https://apstudents.collegeboard.org/courses/ap-spanish-language-and-culture/assessment> |
| `chinese-language-and-culture` | **120** | "Approximately 2hrs" | <https://apstudents.collegeboard.org/courses/ap-chinese-language-and-culture/assessment> |
| `japanese-language-and-culture` | **120** | "Approximately 2hrs" | <https://apstudents.collegeboard.org/courses/ap-japanese-language-and-culture/assessment> |

French/German/Italian/Spanish shipped a wrong `180`/`183` in production and are
corrected to the published **150**. Chinese/Japanese were already correct at
**120**; this card's first build wrote `"pending"` over them and that is now
reverted. `statistics.totalMinutes` stays **180** ("3hrs", `statistics.json`),
unchanged — both its 90-minute sections and its overall total are published.
Every other subject's `totalMinutes` was verified subject-by-subject to already
equal its patched `totalMinutesStated`, so **no other subject was touched**. The
four portfolio-only subjects (`research`, `drawing`, `2-d-art-and-design`,
`3-d-art-and-design`) have no sit-down exam and keep `0`.

### Design decision — approximate durations stored as the rounded integer; hedge dropped

Four of the six totals are printed with a hedge ("Approximately 2hrs 30mins",
"Approximately 2hrs") and the provenance flags each `totalMinutesApproximate:
true`. The schema stores `totalMinutes` as an integer and this card makes **no
schema change**, so the hedge is **dropped in the data layer**: French is stored
as `150` and `InfoPanel` renders "2 hr 30 min" with no "about". This is
deliberate. Surfacing the hedge in the UI ("about 2 hr 30 min") or carrying a
per-value approximate flag is a schema + `InfoPanel` change that belongs with
#44's duration model, not a count-fix card. The hedge is not lost — it is kept
verbatim in `totalMinutesVerbatim` / `totalMinutesApproximate` in the provenance
for whoever builds that UI.

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
2. **Per-section timing splits** — the provenance carries Part A/B and
   per-question `minutes` for many subjects (e.g. the language exams' 80-minute
   MCQ = 40 listening + 40 reading) that the flat `mcqMinutes`/`frqMinutes`
   schema cannot express; those splits belong to #44's `sections[]` model. Note:
   after the `171cb15` provenance patch every sit-down subject's **overall**
   `totalMinutes` is published and correct here — including `microeconomics`
   (130) and `psychology` (160), earlier believed unsourced but in fact printed
   as the AP Students `Exam Duration`. Only the intra-section splits remain #44's
   job.

### Design decision — keep the range type in `questionCount`

After these corrections **no subject uses a range** for `mcqCount`/`frqCount`
(Chinese and Japanese moved to the fixed 55). The `questionCount` union in
`schema.ts` still accepts a published range string (`/^\d+–\d+$/`). It is
**kept**, not removed: (a) the issue constrains this card to "no schema change";
(b) College Board has printed adaptive ranges before and may again in a future
cycle, so retaining the type keeps the model able to represent a published range
without a schema migration. The data test below pins the seven counts as exact
integers so a future re-source cannot silently regress them back to a range.

## Per-section `sections[]` breakdown (issue #44; re-verified for 2027 on 2026-07-24)

`format.sections` replaced the flat `mcqCount`/`frqCount`/`frqType` fields.
Every value is populated from the provenance records for all 43 subjects
committed at `docs/super-board/research/collegeboard-2027/<id>.json` (fetched
**2026-07-24** from `apcentral.collegeboard.org/courses/ap-<slug>/exam`, with
`apstudents.collegeboard.org/courses/ap-<slug>/assessment` as the second
opinion; the extracted text of every page fetched is committed alongside them
under `.../pages/<id>.txt`). Section **weights** and **Part A/B
structures** come from the AP Central exam pages — the AP Students assessment
page usually omits per-section times. Values unchanged from May 2026 kept their
2026 provenance quote after the 2027 page was diffed against it and matched;
the seven subjects whose numbers moved carry fresh 2027 quotes and a
`changedFor2027` note. `src/data/ap-2027.sections.test.ts` re-derives every
section from the provenance on each test run, so a hand-edit or fabrication
fails CI.

### Normalization rules (provenance record → dataset)

- **Section names verbatim** — the titles College Board prints ("Section IIB:
  Free Response: Sight Singing"), never forced into an MCQ/FRQ mold, and
  since issue #73 including the printed `Section <roman>:` prefix on every
  sit-down subject (see "Printed section titles" below). Two records
  (`german-`, `italian-language-and-culture`) listed Section II before
  Section I in fetch order; the dataset restores the printed Section I/II
  order (sorting applies only when every section name carries a parseable
  "Section <roman>" prefix).
- **`questionCount`**: numeric string → number; `"pending"` stays literal;
  `"n/a"` → the field is **omitted** (the page prints no count — a project is
  not a question set); descriptive text (`"4 pre-recorded questions"`) → field
  omitted, text carried into the row's `note`. Omission ≠ "pending": omission
  means the concept does not apply, "pending" means unpublished.
- **`minutes`**: numbers verbatim; hyphenated published ranges normalized to
  the en-dash form the popup renders verbatim (`"40-45"` → `"40–45"`);
  `"pending"` stays literal. **Never back-computed** — AP Japanese's section
  totals stay `"pending"` even though its part times (25 + 40) are published,
  because the page prints no section total.
- **`weightPercent`** (section level): verbatim printed numbers, always the
  share of the **exam** score. (Until issue #73 AP Seminar shipped 13.5/31.5
  here — the printed "30% of 45%" / "70% of 45%" multiplied out. Those were
  back-computed and are gone; see "Per-part weights" below.)
- **`weightPercent` / `weightPrinted`** (part level, issue #73): a part carries
  at most ONE of them, chosen by the denominator College Board printed. See
  "Per-part weights" below — the STORED value is never converted between
  denominators. (Issue #83 changed only what the surfaces *display*; no stored
  weight moved fields, and the dataset JSON is byte-identical across that
  change.)
- **`parts[]`**: present only where the page publishes a split or a printed
  per-question breakdown; `toolNote` carried verbatim into `note`
  (`"n/a"`/`"none"`/`null` → omitted). A part's `minutes` is **omitted** where
  the page prints no length for it at all (AP Art History's six essay
  questions, AP Seminar's research report) and `"pending"` where a length
  exists but is unpublished (AP Psychology's AAQ/EBQ halves of a printed
  70-minute section) — the same omission-vs-pending rule `questionCount` uses.
- **No fabricated aggregates**: sub-parts are never summed into a parent the
  page does not print. AP Music Theory stays 7 + 2 in separate sections ("9"
  appears nowhere); AP African American Studies' project component is never
  folded into an exam-day section ("5" likewise). Same class of error as
  back-computing from the total (PRD §7.5/§8/§11).
- **`frqType` carryover**: the old flat `frqType` composition strings (sourced
  in issues #2/#45) were kept as the free-response section's `note` for the 20
  plain two-section exams (exactly one section named like a free-response
  section, no parts anywhere) — e.g. statistics' pinned "3 multi-part
  questions + 1 inference question…". Where parts or 3+ sections exist, the
  published structure supersedes the old aggregate description, several of
  which were fabricated sums.

### Spot-check finding — four commentary `toolNote`s (resolved by issue #73)

The `japanese-` and `spanish-language-and-culture` MC Listening/Reading part
records carried fetcher commentary as `toolNote` ("listening/audio, no
calculator (world language exam)", "digital exam via Bluebook") while their
own verbatim `quote` fields printed "…; **25% of Score**". Issue #44 worked
around this by scraping the printed share back out of the quote inside the
round-trip test. Issue #73 gave the weight a field of its own, so those four
records now carry `weightPercent: 25` and no `toolNote` at all, and the
scrape-the-quote workaround is deleted.

### Spot-check finding — four false `"pending"` values corrected (2026-07-09)

The issue-#44 builder spot-checked the populated sections against the **live
AP Central pages (raw HTML)**, per the ticket ("if any disagrees, trust the
live page"). Calculus AB and Music Theory matched exactly; four provenance
`"pending"` values did not survive:

| Subject | Field | Page prints | Why the record missed it |
|---|---|---|---|
| `japanese-language-and-culture` | Section I `minutes` | "4 Questions \| 40–45 Minutes \| 50% of Score" | record fetched from the apstudents assessment page (`fallbackUsed`), which omits per-section times — lesson 1 |
| `japanese-language-and-culture` | Section II `minutes` | "55 Questions \| 65 Minutes \| 50% of Score" | same fallback |
| `italian-language-and-culture` | Section I `minutes` | "3 Questions \| 65–70 Minutes \| 50% of Score" | the record's own `quote` prints the range; only the value field said "pending" |
| `french-language-and-culture` | Question 3: Argumentative Essay part `minutes` | "(55 minutes, including 2 opportunities to listen to audio)" | fetch omission — the german/italian/spanish records all captured the same printed 55 |

All four were corrected in the dataset AND in the provenance records (per-id
and consolidated, `spotCheckPatch2026_07_09` notes), and
`src/data/ap-2027.sections.test.ts` pins them so a future re-source cannot
regress them back to "pending".

## Printed section titles and per-part weights (issue #73)

Two problems the #44 model left open, both fixed from the same 2026-07-24
captures already committed under
`docs/super-board/research/collegeboard-2027/pages/<id>.txt` — no new fetch.

### Printed section titles (decision **D2** — Roman)

College Board contradicts itself between its two pages for the same exam: the
AP Central `/exam` page prints `Section I: Multiple Choice`, and the AP
Students `/assessment` block on the same capture prints `Section 1:`
(`art-history.txt:99`, `european-history.txt:105`). **AP Central's Roman form
wins**, because AP Central is already this repo's structure source for section
names, weights, and part splits (see the section above). 24 subjects shipped
the un-prefixed `Multiple Choice` / `Free Response` form and now carry the
printed one; `ap-2027.sections.test.ts` fails on any bare or Arabic-numbered
section name.

Four subjects' titles changed by more than a prefix:

| Subject | Was | AP Central prints | Line |
|---|---|---|---|
| `computer-science-principles` | `Multiple Choice` / `Written Response` | `Section I: End-of-Course Multiple-Choice Exam` / `Section II: Create Performance Task and Written Response` | `computer-science-principles.txt:36,41` |
| `united-states-history` | `Section II: Free Response (Document-Based Question and Long Essay)` | `Section II: Document-Based Question and Long Essay` | `united-states-history.txt:45` |
| `world-history-modern` | `Section IA:` / `Section IB:` / `Section II: Free Response` | `Section I, Part A:` / `Section I, Part B:` / `Section II: Document-Based Question and Long Essay` | `world-history-modern.txt:33,38,45` |
| `japanese-language-and-culture` | `Section I: Free Response` / `Section II: Multiple Choice` | `Section I: Free-Response` / `Section II: Multiple-Choice` (hyphenated, as the other five language exams already were) | `japanese-language-and-culture.txt:40,58` |

`african-american-studies` lost an invented structure rather than a name: the
dataset had two sibling `Section II:` sections (Short-Answer 18%,
Document-Based 12%) where College Board prints **one** `Section II: Free
Response` (4 Questions | 1hr 25mins | 30% of Score) with those two as its
parts (`african-american-studies.txt:142-159`). Five sections → four. The
`Individual Student Project` (8.5%) stays the separate top-level component the
page prints it as (`:60`, `:164`).

### Per-part weights (decision **D1** — the denominator is part of the datum)

Before #73 the part-row weight cell was a hardcoded `––` on every subject, and
the 13 weights the dataset did hold were smuggled into `note` free text in
three inconsistent phrasings. They now have fields. What forced two fields
rather than one is that College Board prints per-part weights against **three
different denominators**:

| Form | Example (verbatim) | Capture | Stored as |
|---|---|---|---|
| % of the **exam** score | `43.75% of exam score` | `precalculus.txt:36` | `weightPercent: 43.75` |
| % of the **section** score | `1 long free-response question (50% of section score).` | `macroeconomics.txt:35` | `weightPrinted: "50% of section score"` |
| % **of another %** | `50% of 20%` | `seminar.txt:42` | `weightPrinted: "50% of 20%"` |

AP Macroeconomics' long free-response question is 50% of Section II, and
Section II is 33% of the exam. Storing `50` in the exam-denominated field
would tell a student one question is half their grade. **Storing a converted
value is prohibited** — the printed string is the datum, and
`ap-2027.sections.test.ts` refuses any `weightPrinted` that is a bare
exam-denominated share (that belongs in `weightPercent`).

#### Issue #83 (2026-07-25) — the printed string stays; the screen shows 16.5%

D1 above conflated two operations, and #83 separates them. Relabelling a
printed `50` as 50% of the exam is still forbidden and still impossible here.
Multiplying is not: 50% of a section worth 33% of the exam **is** 16.5% of the
exam, and that is the figure a student is trying to work out when they read
the row. The 11 relatively-weighted parts (2 Macro, 2 Micro, 7 Seminar) now
render as `16.5%`, `8.25% each`, `10%`, `24.5%`, `7%`, `3.5%`, `13.5%`,
`31.5%` on both surfaces that show parts.

The arithmetic is a **presentation** step, not a storage one:
`parsePrintedWeight()` in `schema.ts` reads the grammar, `partWeight()` in
`src/lib/exam-sections.ts` multiplies by the section's own stored
`weightPercent`, and this file's provenance chain is untouched — which is
precisely why the presentation layer was chosen over rewriting the 11 parts
into `weightPercent` and relaxing the one-weight-field rule. The verbatim
College Board strings remain in the JSON, so the "traces EVERY populated part
weight" test below still greps all 63 of them out of the captures.

Two guards keep the conversion honest, both in `examSectionSchema`: a printed
form the grammar cannot read is a **schema error** (never a silently wrong
number), and a nested `X% of Y%` whose `Y` disagrees with its section's stored
`weightPercent` is a schema error too. The denominator is always the stored
section value — College Board prints 66/33 for Micro and Macro, which sums to
99, and part rows that reconcile with their own section (16.5 + 8.25 + 8.25 =
33) beat part rows that reconcile with a "corrected" 33.33.

Where each populated weight came from — every one re-greppable in the capture,
and asserted line-by-line by the "traces EVERY populated part weight" test:

| Subject | Parts weighted | Printed as | Source block | Lines |
|---|---|---|---|---|
| `african-american-studies` | 2 (SAQ 18%, DBQ 12%) | exam | AP Central + AP Students | `:44,51` / `:147,159` |
| `calculus-ab` | 4 (35 / 15 / 16.7 / 33.3) | exam | **AP Students only** — AP Central prints the part splits with no weight | `:115,117,125,127` |
| `calculus-bc` | 4 (35 / 15 / 16.7 / 33.3) | exam | **AP Students only** | `:115,117,125,127` |
| `chinese-language-and-culture` | 6 (20 / 15 / 7.5 / 7.5 / 25 / 25) | exam | AP Central + AP Students | `:44,47,50,53,59,61` |
| `european-history` | 2 (DBQ 25%, Long Essay 15%) | exam | AP Central | `:48,54` |
| `french-language-and-culture` | 5 (20 / 15 / 15 / 25 / 25) | exam | AP Central + AP Students | `:46,49,52,57,59` |
| `german-language-and-culture` | 5 (20 / 15 / 15 / 25 / 25) | exam | AP Central + AP Students | `:46,49,52,57,59` |
| `italian-language-and-culture` | 5 (20 / 15 / 15 / 25 / 25) | exam | AP Central + AP Students | `:47,50,53,58,60` |
| `japanese-language-and-culture` | 6 (20 / 15 / 7.5 / 7.5 / 25 / 25) | exam | AP Central + AP Students | `:46,49,52,55,61,63` |
| `macroeconomics` | 2 | **section** | AP Central + AP Students | `:35,36` / `:116,118` |
| `microeconomics` | 2 | **section** | AP Central + AP Students | `:35,36` / `:116,118` |
| `precalculus` | 4 (43.75 / 18.75 / 18.75 / 18.75) | exam | AP Central (see rounding conflict below) | `:36,37,41,46` |
| `seminar` | 7 | **nested** | AP Central "Assessment Format" table | `:42,45,52,55,58,65,68` |
| `spanish-language-and-culture` | 5 (20 / 15 / 15 / 25 / 25) | exam | AP Central + AP Students | `:46,49,52,57,59` |
| `united-states-history` | 2 (DBQ 25%, Long Essay 15%) | exam | AP Central | `:48,54` |
| `world-history-modern` | 2 (DBQ 25%, Long Essay 15%) | exam | AP Central | `:48,54` |

The 13 weights that had been living in `note` free text (`"20% of Score"`,
`"4 pre-recorded questions; 15% of Score"`, `"7.5% of Score; Questions 3 & 4
combined 30 minutes"`) moved into the fields; each note kept only its
non-weight content, verbatim.

**21 subjects publish no per-part weight at all** and their part rows keep the
dash. AP Art History is the one worth naming: its Section II is 50% of the
exam across six essay questions and the capture prints **no** per-question
weight anywhere, so the 50% is never divided by six. That is the ticket's own
limit — Art History reaches structural parity with Calculus BC (printed
`Section I:` / `Section II:` titles, question rows under Section II) but not
content parity, because one exam publishes per-part weights and the other
does not.

Art History's six question titles come from the **AP Students** block, not AP
Central. AP Central splits each label across two lines mid-sentence
(`art-history.txt:38-39`: `Question 1` / `: Comparison is a long essay question
that…`), which is not a usable printed heading. The AP Students block prints
each one whole on a single line (`art-history.txt:115-120`: `Question 1: Long
Essay–Comparison will ask you to compare…`), and the label is the text up to
`will ask you to` — including the long/short distinction the old aggregate note
("6 essay questions (2 long, 4 short)") carried, which is why that note could
be dropped without losing information. Same rule as everywhere: a value ships
only when a page prints it in a form we can quote.

### Decision **D3** — merged question rows: un-merged, not summed

AP Chinese modelled Questions 3 and 4 as two 7.5% rows; AP Japanese merged the
same two published questions into one row carrying no weight. The two
resolutions the ticket allowed were (a) keep the merge and store the summed
15%, or (b) un-merge Japanese to match Chinese. **We un-merged.** College
Board prints Q3 and Q4 separately at 7.5% each on both subjects
(`japanese-language-and-culture.txt:51-56`), so option (b) needs no arithmetic
at all, while (a) would have required a named exception to the never-sum rule.
Both subjects now carry four identically-shaped question rows, with the joint
`"Questions 3 & 4 combined 30 minutes"` in each writing row's note and
`minutes: "pending"` on both — the printed 30 minutes covers the pair and is
never split 15/15.

### AP Seminar — the seven printed components

AP Seminar shipped two sections whose weights (13.5% and 31.5%) were the
printed `30% of 45%` and `70% of 45%` **multiplied out** — a back-computation
that predates #73. The dataset now mirrors College Board's own "Assessment
Format" table: three components at the weights the page prints (Performance
Task 1 at 20%, Performance Task 2 at 35%, End-of-Course Exam at 45%) with
their seven scored components as part rows carrying the nested weights
verbatim. `portfolio` is unchanged and is a different fact — the AP Digital
Portfolio **submission deadline** for the two through-course tasks, not their
score share.

Note what did NOT come back with #83: the old 13.5/31.5 lived at **section**
level, replacing two of College Board's three printed components with two
computed ones. #83 reinstates 13.5% and 31.5% only as the **part** rows
"Understanding and analyzing an argument" and "Evidence-Based argument essay"
under a 45% End-of-Course Exam section — the printed section structure is
still the one on screen, and the section weights are still College Board's.

### `precalculus` — AP Central and AP Students disagree on rounding

| Page | Section I Part A | Section I Part B | Section II Parts A/B |
|---|---|---|---|
| AP Central (`precalculus.txt:36,37,41,46`) | `43.75% of exam score` | `18.75% of exam score` | `18.75% of exam score` |
| AP Students (`precalculus.txt:119,121,127,129`) | `approximately 44% of score` | `approximately 19% of score` | `approximately 19% of score` |

The exact figures ship. AP Central is this repo's structure source, the exact
values sum to the published section weights (43.75 + 18.75 = 62.5;
18.75 + 18.75 = 37.5) and the AP Students page labels its own numbers
"approximately". The rounded pair is recorded here and nowhere else.

### Captures that are not 2027-dated

`art-history.txt:23` shows `Thu, May 14, 2026` — the AP Central page was still
serving the 2026 exam date when the 2027 swap captured it, and its format
block was carried forward into the 2027 dataset unchanged. Nothing in the Art
History rows added by #73 depends on the date (they are question titles with
no weight and no length), but the flag belongs on the record rather than being
silently treated as 2027-published.

### Known gap not closed here

`latin.txt:57` prints a third component — `Course Project—In-Class Checkpoints
| 2% of Exam Score` — that the dataset does not carry; its two sections are
50% + 50%, so adding the 2% row would make the printed weights sum to 102%.
That is College Board's own arithmetic, not ours, but reconciling it needs a
decision this ticket did not take. Recorded here; not invented, not silently
absorbed.

### `"pending"` inventory (re-checked against the live pages 2026-07-24)

Genuinely unpublished values — each was hunted for a "false pending" by an
independent refute-skeptic and survived, then re-verified by the builder
against the live page's raw HTML:

| Subject | Field | URL checked |
|---|---|---|
| `african-american-studies` | "Individual Student Project" section `minutes` (its `questionCount` is omitted — the page prints none; the project is completed during the course) | <https://apcentral.collegeboard.org/courses/ap-african-american-studies/exam> |
| `italian-language-and-culture` | Project Presentation / Project Q&A part `minutes` (the section's 65–70 and the Argumentative Essay's 55 ARE published — see spot-check above) | <https://apcentral.collegeboard.org/courses/ap-italian-language-and-culture/exam> |
| `japanese-language-and-culture` | Section I Questions 1–2 part `minutes` (the page prints prep/response descriptors — "3 minutes to prepare; 3 minutes to present", "40 seconds for each response" — not single per-part figures; the printed combined 30-minute writing figure IS captured on the merged writing part) | <https://apcentral.collegeboard.org/courses/ap-japanese-language-and-culture/exam> |
| `chinese-language-and-culture` | Section I parts (Questions 1–4) `minutes` (same prep/response descriptors; the printed "30 minutes to complete both writing tasks (Questions 3 and 4)" is a combined figure carried in those parts' notes, never split 15/15) | <https://apcentral.collegeboard.org/courses/ap-chinese-language-and-culture/exam> |
| `french-language-and-culture` | Section I Questions 1–2 part `minutes` (Question 3 is published: 55 — see spot-check above) | <https://apcentral.collegeboard.org/courses/ap-french-language-and-culture/exam> |
| `german-language-and-culture` | Section I Questions 1–2 part `minutes` (Question 3 is published: 55) | <https://apcentral.collegeboard.org/courses/ap-german-language-and-culture/exam> |
| `spanish-language-and-culture` | Section I Questions 1–2 part `minutes` (Question 3 is published: 55) | <https://apcentral.collegeboard.org/courses/ap-spanish-language-and-culture/exam> |
| `psychology` | Free Response parts (AAQ / EBQ) `minutes` (only the section's 70 is printed; it is never divided between the two questions) | <https://apcentral.collegeboard.org/courses/ap-psychology/exam> |
| `networking` | the ENTIRE `format` block — `sections: []`, `totalMinutes`, `calculator`, `delivery` — plus `passRate` | <https://apcentral.collegeboard.org/courses/ap-networking/adopt> (no `/exam` page and no AP Students assessment page exists; both 404 on 2026-07-24) |
| `business-with-personal-finance`, `cybersecurity`, `networking` | `passRate` | no administration has happened, so no score distribution exists |
| the six world-language courses with a PPR | `portfolio.weightPct` | the PPR deadline is published; no separate score weight for it is |

Slug exception (as everywhere): AP Business with Personal Finance lives at
`ap-business-personal-finance`.

A **nonexistent** section is never `"pending"`: AP Seminar simply has no
multiple-choice section, and the four portfolio-only subjects (AP Drawing,
2-D/3-D Art and Design, AP Research) have `sections: []` — the popup shows
their portfolio information instead of an empty or zeroed table.

## Course list (43 subjects, including three Career Kickstart courses)

<https://apcentral.collegeboard.org/courses> — the course index, read on
2026-07-24. It lists the 42 courses the May 2026 dataset carried plus **AP
Networking**, whose page is <https://apcentral.collegeboard.org/courses/ap-networking/adopt>.
No 2026 course was removed and none was renamed (AP World History: Modern still
lives at the `ap-world-history` slug).

### Career Kickstart in May 2027

All three AP Career Kickstart courses appear on the 2027 exam schedule:
AP Business with Personal Finance (Tue May 4, Session 1), AP Cybersecurity
(Wed May 5, Session 1), and AP Networking (Fri May 7, Session 2, restricted to
2026-27 pilot schools). The AP Career Kickstart overview page's timeline
confirms the first two — "MAY 2027 · AP Business with Personal Finance, AP
Cybersecurity Exams administered" — and puts AP Networking's own launch in fall
2027 with its exam in **May 2028**
(<https://apcentral.collegeboard.org/courses/ap-career-kickstart>), which is why
the 2027 AP Networking administration is pilot-only and why no exam page for it
exists yet.

None of the three has a score distribution, so all three keep
`passRate: "pending"`. No subject carries a `noExamReason` in this cycle.

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
