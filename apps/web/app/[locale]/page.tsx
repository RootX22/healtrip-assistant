// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

import { notFound } from "next/navigation";
import { Chat } from "@/components/chat";
import { isLocale } from "@/lib/i18n";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <Chat locale={locale} />;
}
