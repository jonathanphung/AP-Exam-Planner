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
    → 130). Where the page publishes a range for question counts (AP Chinese
    "25–35" + "30–40" listening/reading MCQs), the dataset stores the
    published range as a string (e.g. `"55–75"`).
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

## Annual swap (PRD §8)

The May 2027 calendar is unpublished — no 2027 dates are projected anywhere
in the dataset. When College Board posts the 2027 schedule (summer 2026),
swap this JSON for a new `ap-2027.json` and update the window constants in
`schema.ts`.
