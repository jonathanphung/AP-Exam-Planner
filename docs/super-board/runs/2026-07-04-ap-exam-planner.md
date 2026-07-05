# super-board run — ap-exam-planner — started 2026-07-04

Backend: workflow · tier: medium · human_approves_merge: true

| card | lanes | final | column | detail |
|---|---|---|---|---|
| #1 | build:advanced → qa:advanced → review:advanced | advanced | Done | PR #10 marked ready; gates rerun green (lint/build/e2e); truth 90/100; awaiting human squash-merge. Note: Reviewer closed the issue + moved card to Done pre-merge (lifecycle deviation, benign once merged). |
| #2 | build:stopped | stopped | Ready | Operator shutdown mid-Build; WIP pushed to issue-2-ap-2026-dataset (34689f4); no PR; resume via run |
| #2 | build:advanced → qa:failed | failed | QA | QA agent hit Claude session limit (reset 6pm CT); Builder completed: draft PR #11 on issue-2-ap-2026-dataset; relaunched at QA lane 18:25 CT |
| #2 | qa:advanced → review:advanced | advanced | Done | PR #11 ready; 34/34 tests green; truth 90/100; dataset re-verified vs College Board; awaiting human merge |
| #3 | build:advanced → qa:advanced → review:advanced | advanced | Done | PR #12 ready; 14/14 e2e green; truth 90/100; awaiting human merge |
| #4,#6 | none | stopped | Ready | Operator stop (session limit) during classify; no work in flight; both unassigned in Ready — next run picks them up |
| #4 | build:advanced → qa:advanced → review:advanced | advanced | Done | PR #13 ready; reviewer reran gates green (lint, data 34/34, e2e 26/26); truth 90/100; awaiting human merge |
| #6 | build:advanced → qa:advanced → review:advanced | advanced | Done | PR #14 ready; truth 92/100; reviewer rerun 23/23 e2e + data + lint + tsc, 0 open threads; awaiting human merge |
| — | none | parked | n/a | Session end (usage limit); nothing in flight; PRs #13/#14 await human merge; next session verifies merges → promotes #5 → wave at xhigh effort (ultracode session) |
| #5 | none | promoted | Ready | PRs #13/#14 merged during park — promotion gate satisfied; #5 Backlog→Ready, unassigned; next session launches its wave (xhigh/ultracode) |
| #5 | build:advanced | stopped | QA | Build done: draft PR #15 on issue-5-conflict-resolution (8c62dad), local gates green incl. e2e. QA stopped twice mid-flight: first to apply Jon's loop-cap workflow edit (MAX_PASSES=3 + low-impact stop guard, commit 9633799, push pending), then usage-limit park. Claim released, worktree cleaned; resume relaunches at QA lane |
| #5 | qa:bounced → build:advanced → qa:advanced → review:advanced | advanced | Done | QA v1 bounced: AC5 warning rendered "(PMsession)" — red exact-phrase spec f6a81cd; rebuild pass 2 fixed copy defect (ebab2e6); QA v2 all 9 ACs green, e2e 46/46 (evidence 454ef18); review truth 93/100, gates rerun green, 0 open threads; PR #15 marked ready — awaiting human merge. First live bounce-loop: pass 2 of 3, not capped |
