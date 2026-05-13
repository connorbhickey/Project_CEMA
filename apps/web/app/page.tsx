import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

export default async function Page() {
  const { userId } = await auth();
  if (userId) {
    redirect('/dashboard');
  }
  // trailing slash required: [[...sign-in]] is an optional catch-all whose
  // root segment is /sign-in/ (empty catch), not /sign-in (typedRoutes strict)
  redirect('/sign-in/');
}
