-- Migration to add 'note' column to expenses table and ensure compatibility
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS note TEXT;

-- Sync existing data between description and note
UPDATE public.expenses SET note = description WHERE note IS NULL AND description IS NOT NULL;
UPDATE public.expenses SET description = note WHERE description IS NULL AND note IS NOT NULL;

-- Notify PostgREST to immediately refresh its schema cache
NOTIFY pgrst, 'reload schema';
