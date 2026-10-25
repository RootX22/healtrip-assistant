// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

"use client";

import type { Locale, Screening, ScreeningAnswer } from "@healtrip/contracts";
import { useState } from "react";
import { dictionaries } from "@/lib/i18n";

interface Props {
  screening: Screening;
  locale: Locale;
  disabled: boolean;
  onSubmit: (answer: ScreeningAnswer, labels: string[]) => void;
}

/**
 * The one decision taken out of free text: a patient ticks boxes, so "no, it
 * doesn't spread to my arm" can never be misread as a warning sign.
 */
export function SafetyChecklist({ screening, locale, disabled, onSubmit }: Props) {
  const t = dictionaries[locale];
  const [ticked, setTicked] = useState<string[]>([]);

  const toggle = (id: string) =>
    setTicked((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );

  const submit = (positive: string[]) =>
    onSubmit(
      { id: screening.id, positive },
      screening.items.filter((item) => positive.includes(item.id)).map((item) => item.label),
    );

  return (
    <fieldset className="checklist" disabled={disabled}>
      <legend>{screening.prompt}</legend>
      <p className="checklist-hint">{t.checklistHint}</p>
      {screening.items.map((item) => (
        <label key={item.id}>
          <input
            type="checkbox"
            checked={ticked.includes(item.id)}
            onChange={() => toggle(item.id)}
          />
          <span>{item.label}</span>
        </label>
      ))}
      <div className="checklist-actions">
        <button
          type="button"
          className="danger"
          disabled={ticked.length === 0}
          onClick={() => submit(ticked)}
        >
          {t.someApply}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={ticked.length > 0}
          onClick={() => submit([])}
        >
          {t.noneApply}
        </button>
      </div>
    </fieldset>
  );
}
