import { notFound } from "next/navigation";
import { Chat } from "@/components/chat";
import { isLocale } from "@/lib/i18n";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <Chat locale={locale} />;
}
