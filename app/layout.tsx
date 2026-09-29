import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Inter_Tight } from "next/font/google";
import "./globals.css";

/**
 * Two families, two roles, nothing else.
 *
 *  • Instrument Serif — display. A light, high-contrast serif reads as a film
 *    title; a thin grotesk in space reads as a tech company.
 *  • Inter Tight — the narrative lines and the few scientific labels.
 *
 * Downloaded at build time and served from this site — the browser never
 * contacts Google. Exposed as CSS variables so globals.css owns every use.
 */
const serif = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-serif",
});

const sans = Inter_Tight({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "Perihelion",
  description: "A single gravitational flyby.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
