import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "PrepRoom: practise the conversation before you have it",
  description:
    "A communication coach you talk to. Bring a real situation, get specific advice, then rehearse it out loud.",
};

export const viewport: Viewport = {
  // Browser chrome can't read CSS variables, so these two mirror --page in
  // globals.css. They are the only hex values outside that file, so keep them in sync.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#efe9de" },
    { media: "(prefers-color-scheme: dark)", color: "#23261f" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
