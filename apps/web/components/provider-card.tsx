// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

import type { Locale, ProviderCard as Provider } from "@healtrip/contracts";
import { countryName, dictionaries, formatFee, languageName, listSeparator } from "@/lib/i18n";

/** Everything here is a directory field; nothing on the card is model-written text. */
export function ProviderCard({ provider, locale }: { provider: Provider; locale: Locale }) {
  const t = dictionaries[locale].card;
  const separator = listSeparator(locale);
  const place =
    provider.facility.kind === "virtual_clinic"
      ? t.virtual
      : [provider.facility.city, countryName(locale, provider.facility.countryCode)]
          .filter(Boolean)
          .join(separator);
  const services = [
    provider.services.inPerson && t.inPerson,
    provider.services.telemedicine && t.telemedicine,
    provider.services.secondOpinion && t.secondOpinion,
  ].filter((s): s is string => Boolean(s));

  return (
    <section className="card" aria-label={provider.name}>
      <p className="card-source">{t.verified}</p>
      <h3>{provider.name}</h3>
      <p className="card-specialty">
        {provider.specialty}
        {provider.focus && <span> · {provider.focus}</span>}
      </p>
      <p className="card-facility">
        {provider.facility.name} · {place}
      </p>
      <ul className="tags">
        {services.map((s) => (
          <li key={s}>{s}</li>
        ))}
        {provider.facility.hasEmergencyDepartment && (
          <li className="tag-er">{t.emergencyDepartment}</li>
        )}
      </ul>
      <dl className="facts">
        <div>
          <dt>{t.speaks}</dt>
          <dd>{provider.languages.map((code) => languageName(locale, code)).join(separator)}</dd>
        </div>
        <div>
          <dt>{t.fee}</dt>
          <dd>{formatFee(locale, provider.fee.amount, provider.fee.currency)}</dd>
        </div>
        <div>
          <dt>{t.years(provider.yearsExperience)}</dt>
          <dd>{t.wait(provider.typicalWaitDays)}</dd>
        </div>
      </dl>
    </section>
  );
}
