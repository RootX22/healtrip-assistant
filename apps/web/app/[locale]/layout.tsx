// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Sans_Arabic } from "next/font/google";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { dictionaries, isLocale, LOCALES } from "@/lib/i18n";
import "../globals.css";

const latin = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-latin",
});
const arabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600"],
  variable: "--font-arabic",
});

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: dictionaries[locale].title, description: dictionaries[locale].tagline };
}

// Direction is decided on the server, so an Arabic page never renders left-to-right first.
export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <html
      lang={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
      className={`${latin.variable} ${arabic.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
