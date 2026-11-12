/**
 * Who runs the site and how to reach them, shown on the about, contact and
 * privacy pages. NEXT_PUBLIC_CONTACT_EMAIL overrides the address at build
 * time, so a new one only needs the env var and a redeploy.
 */
export const OWNER_NAME = 'Lucas Yver';

export const CONTACT_EMAIL =
  process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || 'lucasyv12@gmail.com';
