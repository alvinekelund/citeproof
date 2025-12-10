-- Add username column to copilot_sessions for per-user filtering
ALTER TABLE public.copilot_sessions 
ADD COLUMN IF NOT EXISTS username TEXT;

-- Create index for faster lookups by username
CREATE INDEX IF NOT EXISTS idx_copilot_sessions_username ON public.copilot_sessions(username);