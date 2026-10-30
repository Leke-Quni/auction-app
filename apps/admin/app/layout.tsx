import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Auctionly Admin" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="bg-brand px-4 py-2 font-bold text-on-brand">AUCTIONLY ADMIN</header>
        <main className="p-4">{children}</main>
      </body>
    </html>
  );
}
