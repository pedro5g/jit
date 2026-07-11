import type { Metadata, Viewport } from "next";
import { inter, jetbrainsMono, pixelifySans, silkscreen } from "@/lib/fonts";
import { siteDescription, siteName, siteTagline, siteUrl } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${siteName} — ${siteTagline.toLowerCase()}`,
    template: `%s | ${siteName}`,
  },
  description: siteDescription,
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#151822",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${inter.variable} ${jetbrainsMono.variable} ${pixelifySans.variable} ${silkscreen.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
