import { Inter, JetBrains_Mono, Pixelify_Sans, Silkscreen } from "next/font/google";

export const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jbmono",
  display: "swap",
});

export const pixelifySans = Pixelify_Sans({
  subsets: ["latin"],
  variable: "--font-pixelify",
  display: "swap",
  preload: false,
});

export const silkscreen = Silkscreen({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-silkscreen",
  display: "swap",
  preload: false,
});
