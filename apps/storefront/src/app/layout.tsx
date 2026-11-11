import { QuickViewProvider } from '../components/quick-view';
import localFont from 'next/font/local';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getNavigation, storeSettings } from '../lib/catalog-api';
import { Header } from '../components/header';
import { FocusRefresh } from '../components/focus-refresh';
import './globals.css';
const storeFont = localFont({
  src: '../fonts/Jost-Variable.ttf',
  variable: '--font-store',
  display: 'swap',
  weight: '100 900',
  fallback: ['Arial', 'sans-serif'],
});
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: {
      default: 'Your everyday edit | ' + storeSettings().brand,
      template: '%s | ' + storeSettings().brand,
    },
    description: 'Discover clothing and lifestyle pieces.',
    robots: { index: false, follow: false },
  };
}
export default async function Layout({ children }: { children: React.ReactNode }) {
  const settings = storeSettings(),
    categories = await getNavigation();
  return (
    <html lang="en" className={storeFont.variable}>
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <Header brand={settings.brand} categories={categories} />
        <QuickViewProvider>{children}</QuickViewProvider>
        <footer className="store-footer">
          <div>
            <Link href="/" prefetch={false} className="footer-wordmark">
              {settings.brand}
            </Link>
            <p>Clothing. Lifestyle. Your everyday.</p>
          </div>
          <nav aria-label="Footer navigation">
            <Link href="/" prefetch={false}>
              The edit
            </Link>
            <Link href="/shop" prefetch={false}>
              Explore the collection
            </Link>
          </nav>
          <div className="footer-note">
            <span>Bangladesh / BDT</span>
            <small>Store preview. Online ordering is not open yet.</small>
          </div>
        </footer>
        <FocusRefresh />
      </body>
    </html>
  );
}
