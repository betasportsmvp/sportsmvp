import type { Metadata, Viewport } from "next";
import { appConfig } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: appConfig.name, template: `%s · ${appConfig.name}` },
  description: appConfig.tagline,
  applicationName: appConfig.name,
  appleWebApp: { capable: true, title: appConfig.name, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: appConfig.themeColor,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
