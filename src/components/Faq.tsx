import { faqItems, faqJsonLd } from "@/lib/faq";

/*
 * Homepage FAQ (issue #116): a server-rendered section at the bottom of the
 * planner column, so the root page carries crawlable question-and-answer text
 * for the queries the app itself can't answer as UI ("when are the exams",
 * "when are portfolio deadlines"). Renders the SAME array that builds the
 * `FAQPage` JSON-LD — the structured data cannot drift from the visible copy
 * because neither has a second source. It lives INSIDE the planner shell (see
 * the comment in src/app/page.tsx) so the sticky sidebar's containing block
 * still ends where the site footer begins.
 *
 * Serialised at module scope like the layout's WebApplication block: the
 * object is static, and `<` is escaped so a `</script>` sequence inside a
 * JSON string could never end the block early.
 */
const ITEMS = faqItems();
const JSON_LD = JSON.stringify(faqJsonLd()).replace(/</g, "\\u003c");

export function Faq() {
  return (
    <section
      aria-labelledby="faq-heading"
      data-testid="faq-section"
      className="w-full border-t border-slate-200 pt-8 dark:border-slate-800"
    >
      <h2
        id="faq-heading"
        className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100"
      >
        Frequently asked questions
      </h2>
      <div className="mt-4 grid gap-x-10 gap-y-6 sm:grid-cols-2">
        {ITEMS.map((item) => (
          <div key={item.question}>
            <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {item.question}
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              {item.answer}
            </p>
          </div>
        ))}
      </div>
      {/* Structured data. Renders nothing — no layout or paint impact. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON_LD }}
      />
    </section>
  );
}
