import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import Link from 'next/link';
import {
  LayoutDashboard,
  Library,
  Receipt,
  Globe,
  Building2,
  AlertTriangle,
  LogOut,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { signOut } from './actions';
import { getAdminToken } from '@/lib/admin';
import '../globals.css';

const sans = Inter({
  variable: '--font-sans',
  subsets: ['latin'],
  display: 'swap',
});
const mono = JetBrains_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Admin · Game Sales Tracker',
  description: 'Internal back-office',
  robots: { index: false, follow: false },
};

const NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/admin/games', label: 'Games', icon: Library, exact: false },
  {
    href: '/admin/sales-records',
    label: 'Sales records',
    icon: Receipt,
    exact: false,
  },
  {
    href: '/admin/trusted-sources',
    label: 'Trusted sources',
    icon: Globe,
    exact: false,
  },
  {
    href: '/admin/publishers',
    label: 'Publishers',
    icon: Building2,
    exact: false,
  },
  {
    href: '/admin/issues',
    label: 'Issues',
    icon: AlertTriangle,
    exact: false,
  },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const token = await getAdminToken();

  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="bg-background flex min-h-full">
        {token ? (
          <>
            <aside className="bg-card border-border hidden w-60 shrink-0 flex-col border-r p-4 md:flex">
              <Link
                href="/admin"
                className="text-primary mb-6 px-2 text-sm font-semibold tracking-wide uppercase"
              >
                Admin
              </Link>
              <nav className="flex flex-col gap-1">
                {NAV_ITEMS.map((item) => (
                  <Button
                    asChild
                    key={item.href}
                    variant="ghost"
                    className="justify-start"
                  >
                    <Link href={item.href}>
                      <item.icon aria-hidden="true" className="size-4" />
                      {item.label}
                    </Link>
                  </Button>
                ))}
              </nav>
              <Separator className="my-4" />
              <form action={signOut}>
                <Button
                  variant="ghost"
                  type="submit"
                  className="text-muted-foreground w-full justify-start"
                >
                  <LogOut aria-hidden="true" className="size-4" />
                  Sign out
                </Button>
              </form>
            </aside>
            <main className="min-w-0 flex-1">{children}</main>
          </>
        ) : (
          <main className="min-w-0 flex-1">{children}</main>
        )}
      </body>
    </html>
  );
}
