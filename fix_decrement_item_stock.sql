-- ==============================================================================
-- FIX: Decrement Item Stock Safely (Raw Materials & Manufacturing Inventory)
-- Matches exact statement: UPDATE items SET current_stock = GREATEST(0, current_stock - qty) WHERE id = item_id;
-- ==============================================================================

-- 1. Ensure current_stock column exists with 0 default
ALTER TABLE public.items 
ADD COLUMN IF NOT EXISTS current_stock NUMERIC DEFAULT 0;

-- 2. Drop existing function if parameter names differ to prevent conflict
DROP FUNCTION IF EXISTS public.decrement_item_stock(INTEGER, NUMERIC);

-- 3. Stored Procedure using the user's exact logic and parameter names (item_id, qty)
CREATE OR REPLACE FUNCTION public.decrement_item_stock(item_id INTEGER, qty NUMERIC)
RETURNS VOID AS $$
BEGIN
    UPDATE public.items 
    SET current_stock = GREATEST(0, COALESCE(current_stock, 0) - qty) 
    WHERE id = item_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Grant execution permissions
GRANT EXECUTE ON FUNCTION public.decrement_item_stock(INTEGER, NUMERIC) TO postgres, service_role, anon, authenticated;

-- 5. Force refresh version update so connected clients reload and receive latest changes
INSERT INTO public.system_configs (key, value, updated_at)
VALUES ('force_refresh_version', extract(epoch from now())::text, now())
ON CONFLICT (key) DO UPDATE 
SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;
