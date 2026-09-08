import type { Metadata, Viewport } from "next";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";
import { THEME_SCRIPT } from "@/lib/theme";
import ServiceWorker from "@/components/app/ServiceWorker";

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
  applicationName: "Prime AI",
  manifest: "/manifest.webmanifest",
  /**
   * iOS does not read the manifest. Installing to an iPhone home screen needs
   * these, and without them the app opens in Safari's chrome with an address
   * bar over the room and a screenshot for an icon.
   *
   * The status bar is "default" rather than translucent: the room's controls
   * sit at the top of the stage, and content sliding under the clock is worse
   * than a few pixels of bar.
   */
  appleWebApp: {
    capable: true,
    title: "Prime AI",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/app-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  // A phone reading a number as a phone number and colouring it blue is not
  // something this app ever wants.
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // Installed, this fills the screen: the room must reach into the notch and
  // the home indicator rather than sitting in a letterbox.
  viewportFit: "cover",
  initialScale: 1,
  // Zoom is left alone deliberately. A room with a camera in it would be
  // tidier without pinch zoom, and iOS has ignored user-scalable=no since iOS
  // 10 in any case, but someone who needs to magnify text is not a mis-tap.
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
        {/*
          Next emits the standardised mobile-web-app-capable, which Safari has
          only honoured since 15.4. Plenty of the phones this is for are older
          than that, and without the Apple-prefixed name they install to the
          home screen and then open inside Safari's chrome, with an address bar
          across the top of the room.
        */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        {/* Before first paint, so a user who chose dark never sees a white
            flash, and everyone else never sees dark at all. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="font-sans antialiased">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
