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
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzaWdqYnNwbGpsdXdkdHV2b2NnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk4NTkxODcsImV4cCI6MjA3NTQzNTE4N30.bpmdQIW7fXzsGKp_QJdkN-s9T5guOdZiHxQK22sT3hM";