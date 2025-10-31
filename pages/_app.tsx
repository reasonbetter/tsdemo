import type { AppProps } from 'next/app';
// Import global CSS
import '@/styles/globals.css';
import ErrorBoundary from '@/components/ErrorBoundary';
import { Inter } from 'next/font/google';

// Load Inter using Next.js font optimization
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

export default function MyApp({ Component, pageProps }: AppProps) {
  return (
    <ErrorBoundary>
      <div className={inter.className}>
        <Component {...pageProps} />
      </div>
    </ErrorBoundary>
  );
}
