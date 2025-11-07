/**
 * shared/config.ts
 * -----------------------------------------------------------------------------
 * Central place to configure Supabase credentials for the extension runtime.
 *
 * Replace the placeholder strings below with your Supabase project's URL and
 * anon key. Keeping them in a single module helps ensure they are tree-shaken
 * into every context (popup, content script, service worker) without duplicating
 * literals across files.
 */

export const SUPABASE_URL = "https://esigjbspljluwdtuvocg.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_bBFZ5UsoZu3kb-ZyZCZvJg_g_Cn9iPn";