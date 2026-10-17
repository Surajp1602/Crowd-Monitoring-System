import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { QueryProvider } from "@/providers/query-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CCD — Crowd Density Control", template: "%s · CCD" },
  description: "Real-time crowd density mapping, anomaly detection and alerting for venues and transit.",
};

export const viewport: Viewport = {
  themeColor: "#0c0e0d",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <QueryProvider>
          {children}
          <Toaster
            theme="dark"
            position="top-right"
            toastOptions={{
              style: {
                background: "var(--ink-3)",
                color: "var(--paper)",
                border: "1px solid var(--rule-strong)",
                borderRadius: "6px",
                fontFamily: "var(--font-sans)",
              },
            }}
          />
        </QueryProvider>
      </body>
    </html>
  );
}
