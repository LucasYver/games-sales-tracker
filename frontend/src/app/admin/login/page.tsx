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
      ? 'Invalid token.'
      : error === 'missing'
        ? 'Token is required.'
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
              Session expired or token invalid. Please sign in again.
            </p>
          )}
          {errorMessage && (
            <p className="text-destructive mb-4 text-sm">{errorMessage}</p>
          )}
          <form action={signIn} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="token">Admin token</Label>
              <Input
                id="token"
                name="token"
                type="password"
                required
                autoFocus
                autoComplete="current-password"
              />
              <p className="text-muted-foreground text-xs">
                The token configured server-side in{' '}
                <code className="font-mono">ADMIN_TOKEN</code>.
              </p>
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
