# AP Exam Planner: Product Requirements Document

## 1. Summary
A public, standalone web app where any AP student picks the exams they are taking and instantly sees official dates, session times, digital portfolio deadlines, scheduling conflicts, exam format, and score data. Exports a personal exam calendar. No login, no accounts, no business branding. Portfolio project.

## 2. Problem
AP exams run on one fixed national calendar set once a year by College Board. Students juggling several exams need to know which dates apply to them, whether any exams land in the same slot (a real conflict requiring late testing), when any digital portfolio work is due (often before the exam window even opens, and worth a large share of the final grade), and what to expect on exam day. Today that means digging through a dense calendar page per subject. This app collapses it into one selection and one view.

## 3. Goals
- Build a personal AP exam list from the full current subject catalog
- Show official date and AM/PM session per selected exam
- Surface digital portfolio deadlines for subjects that require them, since they land before the exam window and are easy to overlook
- Flag same slot conflicts and let the student resolve them: choose which exam stays at the regular time, the other moves to its real late-testing slot
- Show format and score data per subject: MCQ/FRQ mix, calculator policy, digital vs paper, most recent pass rate
- Export the personal list as a calendar file (ICS)
- Zero setup: no login, no account, mobile friendly

## 4. Non-Goals (v1)
- Accounts or login
- Tutoring business branding, links, or lead capture
- Countdown timers
- Registration or fee deadline tracker
- AI study planning or content generation
- Native mobile app
- Multi-year historical archive

## 5. Users
Primary: any high school student registered for one or more AP exams, especially those stacking multiple exams in the same two week testing window.
Secondary: a parent or counselor checking a student's exam load.

## 6. Core Flow
1. User lands on the home screen: searchable grid of every current AP subject.
2. User taps subjects to add them to "My Exams." Selection is saved locally, no login required.
3. A personal schedule view builds automatically, sorted by date and grouped by AM/PM. Subjects with a digital portfolio component also show their submission deadline, which lands before the exam window.
4. Any two selected exams sharing a date and session trigger a conflict prompt: the student picks which one stays at the regular time. The other is automatically reassigned to its real late-testing date and session. A short note clarifies this is a planning choice, the actual swap still goes through the school's AP coordinator.
5. Tapping a subject opens an info panel: MCQ count, FRQ count and type, total time, calculator policy, digital vs paper, and the most recently published pass rate.
6. User taps "Export to Calendar" and downloads an ICS file with every selected exam as an event.

## 7. Functional Requirements

### 7.1 Subject catalog
- Full current AP subject list, roughly 40 subjects across STEM, Humanities, Languages, Arts, and the newer Career Kickstart courses.
- Each entry: name, category, exam date, session, format summary, pass rate, and a digital portfolio deadline where applicable (for example AP Seminar, AP Research, AP Computer Science Principles, and AP Art and Design).
- Searchable and filterable by category.

### 7.2 Selection and persistence
- Add or remove subjects from "My Exams" with one tap.
- Store selection in browser localStorage. No account, survives refresh, does not sync across devices.

### 7.3 Schedule view
- Default: list grouped by date and session.
- Portfolio deadlines appear on the same list, styled distinctly from sit-down exams since they are submission due dates, not test times.
- Stretch: visual two week calendar grid mirroring the real AP testing window.

### 7.4 Conflict detection and resolution
- Compare all selected exams pairwise by date and session.
- Any match opens a resolution prompt naming both exams and the shared slot, asking which one stays at the regular time.
- The exam not chosen is automatically reassigned to its real late-testing date and session, pulled from College Board's separate late-testing calendar.
- The resolved date and session, not the default, drives both the schedule view and the ICS export.
- Clear in-app note: this is a planning choice, not a registration action. The actual swap is arranged through the school's AP coordinator.
- Edge case: if three or more selected exams share one slot, the same choose-one-to-keep flow applies, the rest move to late testing. If any of those late-testing dates also collide with each other, surface a second warning rather than silently overwriting.
- Portfolio deadlines do not trigger this flow. There is no physical conflict in submitting two pieces of work on the same day, they are shown on the schedule but never compared for conflicts.

### 7.5 Exam info panel
- Per subject: MCQ count, FRQ count and type, total exam length, calculator policy, digital or paper format.
- Most recent published pass rate, percent scoring 3 or higher. Source from College Board's annual AP Score Distribution report. Do not estimate or invent numbers. Where College Board publishes no distribution for a subject, omit the field: the row stays and its cell shows the not-published dash (issue #84 retired the earlier "pending" marker). A subject that has never been administered also carries a sourced one-line reason, so the dash does not read as missing data.

### 7.6 Calendar export
- One button generates a standard ICS file with every selected exam as a timed event: date, start time based on session, subject name.
- Must open cleanly in Google Calendar, Apple Calendar, and Outlook.

## 8. Data Requirements and Constraint
Four data requirements, all public, all refreshed annually by College Board:
- Exam calendar: subject, date, session. Source: College Board's official AP Calendar at apstudents.collegeboard.org/calendar.
- Late-testing calendar: subject, late-testing date, session. Same source, published alongside the main calendar. Powers the conflict resolution flow in 7.4.
- Digital portfolio deadlines: subject, deadline date and time. Applies to a handful of subjects, for example AP Seminar, AP Research, and AP Computer Science Principles (April 30 in the 2026 cycle), and AP Art and Design (May 8 in the 2026 cycle). These land before the exam window and can carry 30 to 75 percent of the final score depending on subject, so they need equal visual weight to exam dates. Note in-app that a school or teacher often sets an earlier internal deadline than the official one.
- Score distributions: pass rate and 5 rate per subject. Source: College Board's annual AP Score Distribution report.

Known constraint: as of this writing, College Board has not published the 2026-27 (May 2027) exam calendar, late-testing dates, or portfolio deadlines. Expected in fall 2026. Recommendation: ship v1 seeded with the most recently confirmed calendar (the 2026 cycle: primary exam dates, late-testing dates, and portfolio deadlines), store all three as one swappable JSON file, and show a visible note on the schedule view stating which testing year the dates reflect. Update the JSON once the 2027 grid posts. Do not project future dates as confirmed.

> **Status update (2026-07-24, issue #37):** that constraint is resolved. College Board published the May 2027 calendar, late-testing dates, and portfolio deadlines, and the swap has been executed — the live dataset is `src/data/ap-2027.json` and the 2026 portfolio anchors quoted above are superseded by **2027-04-30** (Seminar / Research / CSP) and **2027-05-07** (Art and Design). The paragraph above is kept as written for provenance. The standing rule is unchanged and is about whichever cycle is *next*: do not project an unpublished calendar.

## 9. Technical Recommendation
- Next.js, React, TypeScript, Tailwind. Matches both reference apps and needs no backend.
- All data ships as static JSON bundled with the app. No database for v1. State is entirely client side.
- ICS generation: build the ICS string directly or use a small client side library.
- Deploy on Vercel.
- Keep the app self-contained enough (static assets, no server dependency) that it can later be repackaged as a Chrome extension's new-tab page with no rewrite. See Section 12.

## 10. Non-Functional Requirements
- Mobile first responsive layout.
- Fast load: all data static, no network calls after page load.
- Accessible: keyboard navigable subject picker, sufficient contrast on conflict warnings.

## 11. Risks
- Subject list and score data must stay current. College Board adds and retires subjects periodically.
- 2027 calendar not yet public, see Section 8.
- Score distribution reporting timing can vary slightly by subject.
- Portfolio deadlines carry real stakes for the subjects that have them. Get these dates exact, do not approximate.

## 12. Stretch Goals (v2+)
- Countdown timers per exam
- Registration and fee deadline tracker
- Shareable schedule via URL instead of only localStorage
- Multi-year historical archive
- Visual calendar grid as the default view
- Package the same client-side app as a Chrome extension (new-tab style bundle), reusing the existing code with no rewrite.
