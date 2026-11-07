import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound, permanentRedirect } from "next/navigation";
import { localeLanguages } from "@/i18n/routing";
import { getFranchiseHub } from "@/lib/api";
import { GameHubPage } from "@/components/chart-room/HubPage";

type Params = Promise<{ locale: string; slug: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const [hub, t] = await Promise.all([
    getFranchiseHub(slug),
    getTranslations({ locale, namespace: "hubs" }),
  ]);
  if (!hub) return { title: "Not found" };

  const path = `/franchise/${hub.slug}`;
  const title = t("franchiseTitle", { name: hub.name });
  const description = t("franchiseDescription", {
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

export default async function FranchisePage({ params }: { params: Params }) {
  const { locale, slug } = await params;
  const [hub, t] = await Promise.all([
    getFranchiseHub(slug),
    getTranslations({ locale, namespace: "hubs" }),
  ]);
  if (!hub) notFound();
  // A franchise slug from before the IGDB series answers with the hub its
  // games moved to.
  if (hub.slug !== slug) permanentRedirect(`/${locale}/franchise/${hub.slug}`);

  return (
    <GameHubPage
      locale={locale}
      path={`/franchise/${hub.slug}`}
      title={t("franchiseTitle", { name: hub.name })}
      hub={hub}
      kind="franchise"
    />
  );
}
