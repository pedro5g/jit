import { SiteFooter } from "@/components/landing/footer";
import { SiteHeader } from "@/components/landing/header";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
    </>
  );
}
