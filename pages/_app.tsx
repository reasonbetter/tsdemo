import type { AppProps } from 'next/app';
// Import the new global CSS file using the alias
import '@/styles/globals.css';

export default function MyApp({ Component, pageProps }: AppProps) {
  return (
    <Component {...pageProps} />
    // The old <style jsx global> block is completely removed.
  );
}
