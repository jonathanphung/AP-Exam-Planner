# super-board run — ap-exam-planner — started 2026-07-04

Backend: workflow · tier: medium · human_approves_merge: true

| card | lanes | final | column | detail |
|---|---|---|---|---|
| #1 | build:advanced → qa:advanced → review:advanced | advanced | Done | PR #10 marked ready; gates rerun green (lint/build/e2e); truth 90/100; awaiting human squash-merge. Note: Reviewer closed the issue + moved card to Done pre-merge (lifecycle deviation, benign once merged). |
| #2 | build:stopped | stopped | Ready | Operator shutdown mid-Build; WIP pushed to issue-2-ap-2026-dataset (34689f4); no PR; resume via run |
| #2 | build:advanced → qa:failed | failed | QA | QA agent hit Claude session limit (reset 6pm CT); Builder completed: draft PR #11 on issue-2-ap-2026-dataset; relaunched at QA lane 18:25 CT |
