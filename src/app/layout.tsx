import type { Metadata, Viewport } from "next";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

/**
 * One serif, used for exactly one thing: the headline on the home screen.
 * Everything else stays Inter. A room where people bring things they are
 * dreading should open with a sentence that reads as written rather than
 * rendered, and a serif does that in a way another weight of the UI font
 * cannot. Anywhere else it would just be decoration.
 */
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  // No `weight`: Fraunces is variable, and next/font only allows the optical
  // axes below when the weight range is left open. SOFT rounds the terminals
  // and WONK is what keeps it from reading as a newspaper.
  axes: ["SOFT", "WONK"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "PrepRoom: practise the conversation before you have it",
  description:
    "A communication coach you talk to. Bring a real situation, get specific advice, then rehearse it out loud.",
};

export const viewport: Viewport = {
  // Browser chrome can't read CSS variables, so these two mirror --page in
  // globals.css. They are the only hex values outside that file, so keep them in sync.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#14161a" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
