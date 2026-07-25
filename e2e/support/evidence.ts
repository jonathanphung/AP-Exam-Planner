import { mkdirSync } from "node:fs";

/**
 * Shared evidence-directory resolver for every spec that writes screenshots,
 * downloads, or logs (issue #71 AC7).
 *
 * ## The problem this replaces
 *
 * Each spec used to hardcode its own `docs/super-board/runs/issue-<N>-qa-vN`
 * path, so a plain `pnpm test:e2e` rewrote ~98 *historical* evidence PNGs — the
 * exact files older issue/PR comments embed by raw GitHub URL. Every lane had
 * to remember `git checkout -- docs/super-board/runs/` before committing, and a
 * lane that forgot silently replaced the images behind those links. Issue #37
 * fixed it for one spec via a `QA_EVIDENCE_DIR` override; this generalises that
 * to the whole suite and flips the DEFAULT to a throwaway folder.
 *
 * ## Resolution order
 *
 * 1. **`QA_EVIDENCE_DIR`** — an explicit repo-relative target, used verbatim
 *    (the spec's own slug is NOT appended). This is the per-run override a lane
 *    uses when capturing committed evidence for ONE spec:
 *
 *    ```sh
 *    QA_EVIDENCE_DIR=docs/super-board/runs/issue-71-qa-v1 \
 *      pnpm exec playwright test e2e/issue-71-qa.spec.ts
 *    ```
 *
 *    Because the slug is not appended, pointing this at a full-suite run would
 *    funnel every spec into one folder — it is deliberately a single-spec knob.
 *
 * 2. **`QA_EVIDENCE_ROOT`** — a root that each spec's own `slug` is appended
 *    to. `QA_EVIDENCE_ROOT=docs/super-board/runs pnpm test:e2e` reproduces the
 *    old in-place behaviour on purpose, for the rare case of regenerating the
 *    committed folders wholesale.
 *
 * 3. **Default** — `test-results/evidence/<slug>`. `test-results/` is
 *    gitignored, so a full `pnpm test:e2e` leaves `git status
 *    docs/super-board/runs/` clean. That is AC7's acceptance test.
 *
 * The directory is created (recursively) before the path is returned, so specs
 * that write with `node:fs` rather than `page.screenshot({ path })` — which
 * mkdirs on its own — work under every branch above.
 *
 * @param slug the spec's stable evidence folder name, e.g. `issue-51-qa-v1`.
 *             Keep it identical to the historical committed folder so an
 *             explicit `QA_EVIDENCE_ROOT=docs/super-board/runs` run still lands
 *             on the same paths the issue/PR comments link to.
 */
export function evidenceDir(slug: string): string {
  const explicit = process.env.QA_EVIDENCE_DIR;
  const dir = explicit
    ? explicit
    : `${process.env.QA_EVIDENCE_ROOT ?? DEFAULT_EVIDENCE_ROOT}/${slug}`;
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Gitignored default root — see {@link evidenceDir} resolution order step 3. */
export const DEFAULT_EVIDENCE_ROOT = "test-results/evidence";
