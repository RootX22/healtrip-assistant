import type { AssistantTurn, Locale, ScreeningAnswer } from "@healtrip/contracts";
import { dictionaries } from "@/lib/i18n";
import { ProviderCard } from "./provider-card";
import { SafetyChecklist } from "./safety-checklist";
import { Trace } from "./trace";

interface Props {
  turn: AssistantTurn;
  locale: Locale;
  /** Only the latest turn's checklist can still be answered. */
  interactive: boolean;
  onChecklist: (answer: ScreeningAnswer, labels: string[]) => void;
}

export function AssistantTurnView({ turn, locale, interactive, onChecklist }: Props) {
  const t = dictionaries[locale];
  return (
    <article className={`bubble assistant kind-${turn.kind}`}>
      <header className="turn-head">
        <span className="who">{t.assistant}</span>
        <span className="kind">{t.kind[turn.kind]}</span>
      </header>

      {turn.emergency && (
        <a className="emergency-call" href={`tel:${turn.emergency.number}`}>
          <strong>
            {t.call} {turn.emergency.number}
          </strong>
          <span>{turn.emergency.label}</span>
        </a>
      )}

      <p className="message">{turn.message}</p>

      {turn.nextStep && turn.urgency && turn.kind === "recommendation" && (
        <p className="next-step">
          <span className="next-step-label">{t.nextStep[turn.nextStep]}</span>
          <span className="next-step-urgency">{t.urgency[turn.urgency]}</span>
        </p>
      )}

      {turn.questions.length > 0 && (
        <ul className="questions">
          {turn.questions.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ul>
      )}

      {turn.screening && (
        <SafetyChecklist
          screening={turn.screening}
          locale={locale}
          disabled={!interactive}
          onSubmit={onChecklist}
        />
      )}

      {turn.providers.length > 0 && (
        <ol className="providers">
          {turn.providers.map((provider) => (
            <li key={provider.id}>
              <ProviderCard provider={provider} locale={locale} />
            </li>
          ))}
        </ol>
      )}

      <Trace trace={turn.trace} locale={locale} />
    </article>
  );
}
