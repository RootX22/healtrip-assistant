// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

import type { AssistantTurn, Locale } from "@healtrip/contracts";
import { dictionaries } from "@/lib/i18n";

/** The machinery behind an answer, one click away: which engine, which tool calls, whether it passed grounding. */
export function Trace({ trace, locale }: { trace: AssistantTurn["trace"]; locale: Locale }) {
  const t = dictionaries[locale];
  return (
    <details className="trace">
      <summary>{t.trace.summary}</summary>
      <dl>
        <div>
          <dt>{t.trace.engine}</dt>
          <dd>{t.engine[trace.engine]}</dd>
        </div>
        <div>
          <dt>{t.trace.grounding}</dt>
          <dd className={`grounding-${trace.grounding}`}>{t.trace.outcome[trace.grounding]}</dd>
        </div>
      </dl>
      {trace.steps.length > 0 && (
        <ol className="steps" dir="ltr">
          {trace.steps.map((step, index) => (
            <li key={`${step.tool}-${index}`} className={step.ok ? "ok" : "failed"}>
              <code>{step.tool}</code> {step.summary}
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
