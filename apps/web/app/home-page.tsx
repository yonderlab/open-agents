"use client";

import { SignedOutHero } from "@/components/auth/signed-out-hero";
import { HomeSkeleton } from "@/components/home-skeleton";
import { InboxPage } from "@/components/inbox/inbox-page";
import { useSession } from "@/hooks/use-session";

interface HomePageProps {
  hasSessionCookie: boolean;
  lastRepo: { owner: string; repo: string } | null;
}

export function HomePage({ hasSessionCookie, lastRepo }: HomePageProps) {
  const { loading: sessionLoading, isAuthenticated } = useSession();

  if (sessionLoading && hasSessionCookie) {
    return <HomeSkeleton />;
  }

  if (!isAuthenticated) {
    return <SignedOutHero />;
  }

  return <InboxPage lastRepo={lastRepo} />;
}
