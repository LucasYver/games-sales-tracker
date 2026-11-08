import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound, permanentRedirect } from "next/navigation";
import { localeLanguages } from "@/i18n/routing";
import { getPublisherHub } from "@/lib/api";
import { GameHubPage } from "@/components/chart-room/HubPage";

type Params = Promise<{ locale: string; slug: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const [hub, t] = await Promise.all([
    getPublisherHub(slug),
    getTranslations({ locale, namespace: "hubs" }),
  ]);
  if (!hub) return { title: "Not found" };

  const path = `/publisher/${hub.slug}`;
  const title = t("publisherTitle", { name: hub.name });
  const description = t("publisherDescription", {
    name: hub.name,
    count: hub.games.length,
  });
  return {
    title,
    description,
    alternates: {
      canonical: `/${locale}${path}`,
      languages: localeLanguages(path),
    },
    openGraph: { title, description, url: `/${locale}${path}`, locale },
  };
}

export default async function PublisherPage({ params }: { params: Params }) {
  const { locale, slug } = await params;
  const [hub, t] = await Promise.all([
    getPublisherHub(slug),
    getTranslations({ locale, namespace: "hubs" }),
  ]);
  if (!hub) notFound();
  // A publisher slug built from an older spelling answers with the hub its
  // games moved to.
  if (hub.slug !== slug) permanentRedirect(`/${locale}/publisher/${hub.slug}`);

  return (
    <GameHubPage
      locale={locale}
      path={`/publisher/${hub.slug}`}
      title={t("publisherTitle", { name: hub.name })}
      hub={hub}
      kind="publisher"
    />
  );
}
