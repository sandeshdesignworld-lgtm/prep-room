import type { Metadata, Viewport } from "next";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";
import { THEME_SCRIPT } from "@/lib/theme";

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
  title: "Prime AI: practise the conversation before you have it",
  description:
    "A communication coach you talk to. Bring a real situation, get specific advice, then rehearse it out loud.",
};

export const viewport: Viewport = {
  // One value, not a light/dark pair: the app is light unless the user has
  // chosen otherwise, and the system preference must not decide this either.
  // Mirrors --page in globals.css; applyTheme() in lib/theme.ts swaps it when
  // the toggle is used. The only hex outside that file, so keep it in sync.
  themeColor: "#f7f8fa",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <head>
        {/* Before first paint, so a user who chose dark never sees a white
            flash, and everyone else never sees dark at all. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
