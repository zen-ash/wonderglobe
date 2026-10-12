import type { Metadata, Viewport } from "next";
import { Caveat, Fredoka } from "next/font/google";
import "./globals.css";
import { ScreenFX } from "@/ui/ScreenFX";

const round = Fredoka({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-round", display: "swap" });
// Hand-lettering for sticky notes, storybook text, sticker hints and signposts.
const hand = Caveat({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-hand", display: "swap" });

export const metadata: Metadata = {
  title: "Wonderglobe",
  description: "Draw something and watch it come alive on a tiny explorable planet.",
  applicationName: "Wonderglobe",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#9fdad3",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${round.variable} ${hand.variable}`}>
      <body>
        {children}
        {/* Film grain + time-of-day vignette over everything (ignores the pointer). */}
        <ScreenFX />
      </body>
    </html>
  );
}
