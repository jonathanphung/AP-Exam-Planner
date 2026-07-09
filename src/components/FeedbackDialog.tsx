"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useModalDialog } from "@/lib/modal";
import {
  FEEDBACK_COUNTER_THRESHOLD,
  MAX_FEEDBACK_LENGTH,
  submitFeedback,
  validateEmail,
  validateMessage,
} from "@/lib/feedback";

/**
 * In-app feedback dialog (issue #42) — replaces the sidebar's "Send us
 * Feedback" external link. It collects an OPTIONAL email and a REQUIRED
 * message, validates them inline, and routes submission through the single
 * `submitFeedback` seam (src/lib/feedback.ts). It imports nothing else about
 * transport: the human-readable outcome copy travels back on the result, so
 * the backend can drop in without editing this file.
 *
 * Accessibility reuses the already-QA'd `useModalDialog` helper (issue #8):
 * focus is trapped inside, returns to the invoking button on close, Escape
 * closes — EXCEPT while a submit is in flight (the card's rule: not dismissable
 * mid-flight). The dialog is `aria-modal` and labelled by its heading.
 *
 * Three honest states:
 *   - editing  — the form; inline field errors, live counter near the cap.
 *   - pending  — submit disabled, busy indicator, close paths inert.
 *   - success  — a thank-you view showing the transport's own `notice`. It
 *                never claims "sent"/"delivered" unless the adapter says so.
 *
 * No open/close animation is used, so `prefers-reduced-motion` is inherently
 * respected — there is no motion to reduce.
 */

type Status = "editing" | "pending" | "success";

export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const headingId = useId();
  const blurbId = useId();
  const emailHintId = useId();
  const emailErrorId = useId();
  const messageErrorId = useId();
  const counterId = useId();
  const submitErrorId = useId();

  const panelRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const successCloseRef = useRef<HTMLButtonElement>(null);

  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState<Status>("editing");

  const pending = status === "pending";

  // Escape / backdrop / Cancel / ✕ all funnel here. Mid-flight, the dialog is
  // not dismissable (the user's text is in play and a tab is about to open).
  function requestClose() {
    if (pending) return;
    onClose();
  }

  // Focus starts on the email field (first field). Read once on mount by the
  // helper; success focus is handled by the effect below.
  useModalDialog(panelRef, requestClose, emailRef);

  useEffect(() => {
    if (status === "success") successCloseRef.current?.focus();
  }, [status]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const emailResult = validateEmail(email);
    const messageResult = validateMessage(message);
    setEmailError(emailResult.ok ? null : emailResult.error);
    setMessageError(messageResult.ok ? null : messageResult.error);

    if (!emailResult.ok) {
      emailRef.current?.focus();
      return;
    }
    if (!messageResult.ok) {
      messageRef.current?.focus();
      return;
    }

    setSubmitError(null);
    setStatus("pending");
    const result = await submitFeedback({ email, message });
    if (result.ok) {
      setNotice(result.notice);
      setStatus("success");
    } else {
      // Failure: preserve the user's text, surface the error, allow retry.
      setSubmitError(result.error);
      setStatus("editing");
    }
  }

  const showCounter = message.length >= FEEDBACK_COUNTER_THRESHOLD;
  const emailDescribedBy =
    [emailHintId, emailError ? emailErrorId : null].filter(Boolean).join(" ") ||
    undefined;
  const messageDescribedBy =
    [messageError ? messageErrorId : null, showCounter ? counterId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  const overlay = (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={requestClose}
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={status === "success" ? undefined : blurbId}
        aria-busy={pending}
        data-testid="feedback-dialog"
        className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded-t-2xl bg-white p-5 text-slate-900 shadow-xl sm:rounded-2xl sm:p-6 dark:bg-slate-950 dark:text-slate-100"
      >
        <button
          type="button"
          onClick={requestClose}
          aria-label="Close"
          disabled={pending}
          className="absolute top-2 right-2 z-10 flex h-11 w-11 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 sm:h-9 sm:w-9 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-5 w-5"
          >
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
          </svg>
        </button>

        {status === "success" ? (
          <div data-testid="feedback-success">
            <h2
              id={headingId}
              className="pr-10 text-lg font-semibold tracking-tight"
            >
              Thanks — almost there
            </h2>
            <p
              role="status"
              className="mt-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300"
            >
              {notice}
            </p>
            <div className="mt-6 flex justify-end">
              <button
                ref={successCloseRef}
                type="button"
                onClick={onClose}
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 sm:min-h-9 dark:focus-visible:outline-blue-400"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <h2
              id={headingId}
              className="pr-10 text-lg font-semibold tracking-tight"
            >
              Send us feedback
            </h2>
            <p
              id={blurbId}
              className="mt-1 text-sm text-slate-600 dark:text-slate-400"
            >
              Help us make AP Exam Planner better.
            </p>

            {submitError && (
              <p
                id={submitErrorId}
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-500/50 dark:bg-red-950/40 dark:text-red-200"
              >
                <span aria-hidden="true">⚠️</span>
                <span>{submitError}</span>
              </p>
            )}

            {/* Email — optional, unrestricted */}
            <div className="mt-4">
              <label
                htmlFor="feedback-email"
                className="block text-sm font-medium"
              >
                Your email
              </label>
              <p
                id={emailHintId}
                className="text-xs text-slate-500 dark:text-slate-400"
              >
                Optional — only if you&rsquo;d like a reply.
              </p>
              <input
                ref={emailRef}
                id="feedback-email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (emailError) setEmailError(null);
                }}
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailDescribedBy}
                disabled={pending}
                className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:border-blue-500 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 disabled:opacity-60 aria-[invalid=true]:border-red-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus-visible:outline-blue-400"
              />
              {emailError && (
                <p
                  id={emailErrorId}
                  role="alert"
                  className="mt-1 flex items-start gap-1 text-sm text-red-700 dark:text-red-300"
                >
                  <span aria-hidden="true">⚠️</span>
                  <span>{emailError}</span>
                </p>
              )}
            </div>

            {/* Message — required, capped */}
            <div className="mt-4">
              <label
                htmlFor="feedback-message"
                className="block text-sm font-medium"
              >
                Your feedback
              </label>
              <textarea
                ref={messageRef}
                id="feedback-message"
                name="message"
                rows={5}
                required
                value={message}
                maxLength={MAX_FEEDBACK_LENGTH}
                onChange={(event) => {
                  setMessage(event.target.value);
                  if (messageError) setMessageError(null);
                }}
                placeholder="What's working, what's confusing, what's missing…"
                aria-invalid={messageError ? true : undefined}
                aria-describedby={messageDescribedBy}
                disabled={pending}
                className="mt-1 block w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:border-blue-500 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 disabled:opacity-60 aria-[invalid=true]:border-red-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus-visible:outline-blue-400"
              />
              <div className="mt-1 flex items-start justify-between gap-3">
                <span className="min-w-0 flex-1">
                  {messageError && (
                    <span
                      id={messageErrorId}
                      role="alert"
                      className="flex items-start gap-1 text-sm text-red-700 dark:text-red-300"
                    >
                      <span aria-hidden="true">⚠️</span>
                      <span>{messageError}</span>
                    </span>
                  )}
                </span>
                {showCounter && (
                  <span
                    id={counterId}
                    aria-live="polite"
                    className={`shrink-0 text-xs tabular-nums ${
                      message.length >= MAX_FEEDBACK_LENGTH
                        ? "font-semibold text-red-700 dark:text-red-300"
                        : "text-slate-500 dark:text-slate-400"
                    }`}
                  >
                    {message.length.toLocaleString()}/
                    {MAX_FEEDBACK_LENGTH.toLocaleString()}
                  </span>
                )}
              </div>
            </div>

            {/* Footer actions */}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={requestClose}
                disabled={pending}
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60 sm:min-h-9 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 dark:focus-visible:outline-blue-400"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                aria-describedby={submitError ? submitErrorId : undefined}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-70 sm:min-h-9 dark:focus-visible:outline-blue-400"
              >
                {pending && (
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  >
                    <circle
                      cx="12"
                      cy="12"
                      r="9"
                      stroke="currentColor"
                      strokeWidth="3"
                      className="opacity-25"
                    />
                    <path
                      d="M21 12a9 9 0 0 0-9-9"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                  </svg>
                )}
                {pending ? "Sending…" : "Send Feedback"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );

  // Render through a portal on <body> rather than inline (same pattern and
  // reason as MySchedules' delete dialog). The desktop sidebar <aside> is
  // `position: sticky`, which makes it a stacking context that paints *below*
  // <main>. An inline `fixed inset-0 z-50` overlay is trapped inside that
  // context, so its backdrop cannot dim the catalog filter bar (`sticky top-0
  // z-30` in <main>) — the bar stayed lit and clickable over the dim (QA v1).
  // Portaling to <body> lifts the overlay to the root stacking context so it
  // covers the entire app, filter bar included. `document` is always present
  // here: this component only mounts after a client-side click, never during
  // SSR/hydration.
  return typeof document === "undefined"
    ? overlay
    : createPortal(overlay, document.body);
}
