import type { Metadata } from "next";
import "./globals.css";
import GameReconnect from "@/components/game-reconnect";

export const metadata: Metadata = {
  title: "Isletop",
  description:
    "Trade, build, and settle an island with friends. A multiplayer strategy game for up to twelve players.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <GameReconnect />
      </body>
    </html>
  );
}
