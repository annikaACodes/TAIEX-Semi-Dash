import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Taiwan Semiconductor Revenue Monitor",
    template: "%s | Taiwan Semiconductor Revenue Monitor",
  },
  description:
    "Live monthly revenue, growth, subsector momentum, and reporting freshness for Taiwan-listed semiconductor companies.",
  openGraph: {
    title: "Taiwan Semiconductor Revenue Monitor",
    description:
      "Company and subsector monthly revenue intelligence for Taiwan-listed semiconductor companies.",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1730,
        height: 909,
        alt: "Taiwan Semiconductor Revenue Monitor",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Taiwan Semiconductor Revenue Monitor",
    description:
      "Company and subsector monthly revenue intelligence for Taiwan-listed semiconductor companies.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b1f3a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
