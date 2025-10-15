import type { AppProps } from 'next/app';
// Import the new global CSS file using the alias
import '@/styles/globals.css';
import ErrorBoundary from '@/components/ErrorBoundary';

export default function MyApp({ Component, pageProps }: AppProps) {
  return (
    <ErrorBoundary>
      <Component {...pageProps} />
    </ErrorBoundary>
  );
}
