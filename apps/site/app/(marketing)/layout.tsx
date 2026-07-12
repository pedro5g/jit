import { GhostCompanion } from "@/components/brand/ghost-companion";
import { AnnouncementBanner } from "@/components/landing/announcement-banner";
import { SiteFooter } from "@/components/landing/footer";
import { SiteHeader } from "@/components/landing/header";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AnnouncementBanner />
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
      <GhostCompanion />
    </>
  );
}
