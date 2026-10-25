import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signIn } from '../actions';

export default async function AdminLogin({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; error?: string }>;
}) {
  const { reason, error } = await searchParams;

  const errorMessage =
    error === 'invalid'
      ? 'Invalid email or password.'
      : error === 'missing'
        ? 'Email and password are required.'
        : error === 'unreachable'
          ? 'Backend unreachable.'
          : error === 'backend'
            ? 'Backend returned an error.'
            : null;

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to admin</CardTitle>
        </CardHeader>
        <CardContent>
          {reason === 'expired' && (
            <p className="mb-4 text-sm text-amber-600">
              Session expired. Please sign in again.
            </p>
          )}
          {errorMessage && (
            <p className="text-destructive mb-4 text-sm">{errorMessage}</p>
          )}
          <form action={signIn} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                autoFocus
                autoComplete="username"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
              />
            </div>
            <Button type="submit" className="w-full">
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
