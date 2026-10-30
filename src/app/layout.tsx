import type { Metadata } from "next";
import { Outfit, Unbounded } from "next/font/google";
import { THEME_INIT_SCRIPT } from "@/lib/theme-script";
import { BRAND_NAME, PRODUCT_NAME } from "@/lib/brand";
import "./globals.css";

// CADTRI brand fonts: Outfit for text, Unbounded for display headings.
// Self-hosted by next/font (UI UX Pro Max Next.js rule): no external request, no layout shift.
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", display: "swap" });
const unbounded = Unbounded({ subsets: ["latin"], variable: "--font-unbounded", display: "swap" });

export const metadata: Metadata = {
  title: `${BRAND_NAME} · ${PRODUCT_NAME}`,
  description: "Create, test and schedule email campaigns.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // data-theme is set by the inline script before React hydrates, so the attribute legitimately differs
    <html lang="en" className={`${outfit.variable} ${unbounded.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
