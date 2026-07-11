import { test } from "@playwright/test";
import {
  SHOW_SCROLLBARS,
  registerDialogShiftTests,
  registerOverflowTest,
} from "./support/scroll-shift";

/**
 * Issue #49 — custom scrollbar + stable gutter, BUNDLED CHROMIUM channel.
 *
 * Bundled Chromium DROPS the reserved gutter under `overflow: hidden`, so the
 * scroll lock frees the 16px classic scrollbar's width and the centered shell
 * would shift RIGHT — the Windows path. The position-invariant fix
 * (src/lib/modal.ts) must hold the shell's `rect.left` steady.
 *
 * The real-Chrome channel (which RETAINS the gutter and exposed the Jon-bounce
 * over-compensation) lives in `issue-49-real-chrome.spec.ts`; both call the
 * SAME `registerDialogShiftTests()` from `support/scroll-shift.ts`. They are
 * separate files because Playwright forbids `test.use({ launchOptions })` /
 * `test.use({ channel })` inside a describe group.
 *
 * The shift is invisible in overlay-scrollbar mode, so the harness injects
 * `::-webkit-scrollbar { width: 16px }` to force classic scrollbars, and this
 * file drops `--hide-scrollbars` (SHOW_SCROLLBARS) so the forced bar actually
 * occupies layout width. These tests FAIL against pre-#49 main.
 */
test.use(SHOW_SCROLLBARS);

registerDialogShiftTests();
registerOverflowTest();
