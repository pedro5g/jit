import type { Metadata, Viewport } from "next";
import { GhostAssistant } from "@/components/assistant/ghost-assistant";
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
      <body className="font-sans antialiased">
        {children}
        {/* Mounted once, above every route group: the ghost navigates on its
            own, and a conversation that reset on each navigation would make
            that feel like a bug rather than an answer. */}
        <GhostAssistant />
      </body>
    </html>
  );
}
