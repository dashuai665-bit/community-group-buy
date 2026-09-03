import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from '@/components/storefront/app-shell';

export const metadata: Metadata = {
  title: '鄰里湊湊｜社區共同採購',
  description: '鄰里湊湊是以社區為核心的共同採購與揪團平台。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body><AppShell>{children}</AppShell></body>
    </html>
  );
}
