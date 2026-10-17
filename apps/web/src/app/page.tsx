import { redirect } from 'next/navigation';

/** `/` → /hoje (the authenticated shell redirects to /entrar when there is no session). */
export default function Home() {
  redirect('/hoje');
}
