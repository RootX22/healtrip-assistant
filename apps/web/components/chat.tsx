// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

"use client";

import {
  type AssistantTurn,
  type Engine,
  type Locale,
  MAX_MESSAGE_LENGTH,
  type ScreeningAnswer,
} from "@healtrip/contracts";
import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiError, sendMessage, startConversation } from "@/lib/api";
import { dictionaries, listSeparator } from "@/lib/i18n";
import { AssistantTurnView } from "./assistant-turn";

type Message = { from: "patient"; text: string } | { from: "assistant"; turn: AssistantTurn };
type Entry = Message & { id: number };

export function Chat({ locale }: { locale: Locale }) {
  const t = dictionaries[locale];
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);
  const nextId = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);

  const last = entries.at(-1);
  const closed = entries.some((e) => e.from === "assistant" && e.turn.kind === "emergency");

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries, pending]);

  const push = (message: Message) =>
    setEntries((current) => [...current, { ...message, id: (nextId.current += 1) }]);

  async function submit(
    text: string | undefined,
    screening: ScreeningAnswer | undefined,
    shown: string,
  ) {
    if (pending) return;
    setPending(true);
    setError(null);
    push({ from: "patient", text: shown });
    try {
      let id = conversationId;
      if (id === null) {
        const conversation = await startConversation(locale);
        id = conversation.conversationId;
        setConversationId(id);
        setEngine(conversation.engine);
      }
      const turn = await sendMessage(id, { locale, text, screening });
      push({ from: "assistant", turn });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "generic";
      setError({
        message: t.errors[code] ?? t.errors.generic ?? "",
        requestId: e instanceof ApiError ? e.requestId : undefined,
      });
      if (code === "conversation_not_found") setConversationId(null);
    } finally {
      setPending(false);
    }
  }

  function onSend(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    void submit(text, undefined, text);
  }

  function onChecklist(answer: ScreeningAnswer, labels: string[]) {
    const shown =
      answer.positive.length === 0
        ? t.answered.none
        : `${t.answered.some} ${labels.join(listSeparator(locale))}`;
    void submit(undefined, answer, shown);
  }

  function reset() {
    setConversationId(null);
    setEntries([]);
    setError(null);
    setDraft("");
  }

  return (
    <div className="shell">
      <header className="masthead">
        <div>
          <h1>{t.title}</h1>
          <p className="tagline">{t.tagline}</p>
        </div>
        <nav className="masthead-actions">
          {engine && <span className={`engine engine-${engine}`}>{t.engine[engine]}</span>}
          <button
            type="button"
            className="ghost"
            onClick={reset}
            disabled={pending || entries.length === 0}
          >
            {t.newConversation}
          </button>
          <Link
            className="ghost"
            href={locale === "ar" ? "/en" : "/ar"}
            hrefLang={locale === "ar" ? "en" : "ar"}
          >
            {t.switchLanguage}
          </Link>
        </nav>
      </header>

      <p className="disclaimer" role="note">
        {t.disclaimer}
      </p>
      {engine === "rule-based" && <p className="notice">{t.engineNotice}</p>}

      <main className="log" aria-live="polite" aria-busy={pending}>
        {entries.map((entry) =>
          entry.from === "patient" ? (
            <div key={entry.id} className="bubble patient">
              <span className="who">{t.you}</span>
              <p>{entry.text}</p>
            </div>
          ) : (
            <AssistantTurnView
              key={entry.id}
              turn={entry.turn}
              locale={locale}
              interactive={entry === last && !pending}
              onChecklist={onChecklist}
            />
          ),
        )}
        {pending && <div className="bubble assistant pending">{t.sending}</div>}
        <div ref={endRef} />
      </main>

      {error && (
        <p className="error" role="alert">
          {error.message}
          {error.requestId && (
            <span className="reference">
              {t.reference}: <code>{error.requestId}</code>
            </span>
          )}
        </p>
      )}

      {closed ? (
        <div className="closed">
          <p>{t.emergencyClosed}</p>
          <button type="button" onClick={reset}>
            {t.newConversation}
          </button>
        </div>
      ) : (
        <form className="composer" onSubmit={onSend}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) onSend(e);
            }}
            placeholder={t.placeholder}
            maxLength={MAX_MESSAGE_LENGTH}
            rows={2}
            disabled={pending}
            aria-label={t.placeholder}
          />
          <button type="submit" disabled={pending || draft.trim().length === 0}>
            {pending ? t.sending : t.send}
          </button>
        </form>
      )}
    </div>
  );
}
