ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS moderation_message text,
  ADD COLUMN IF NOT EXISTS moderation_previous_status text,
  ADD COLUMN IF NOT EXISTS penalty_until timestamptz;

CREATE OR REPLACE FUNCTION public.enforce_report_moderation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  profile_status text;
  previous_status text;
  restricted_until timestamptz;
BEGIN
  SELECT upper(coalesce(verification_status, '')),
         moderation_previous_status,
         penalty_until
    INTO profile_status, previous_status, restricted_until
    FROM public.profiles
   WHERE device_id = NEW.device_id
   FOR UPDATE;

  IF profile_status = 'BANNED' THEN
    RAISE EXCEPTION 'This device is banned from submitting reports until the ban is lifted.';
  END IF;

  IF profile_status = 'PENALIZED' AND (restricted_until IS NULL OR restricted_until > now()) THEN
    RAISE EXCEPTION 'Report submissions are paused by an active penalty.';
  END IF;

  IF profile_status = 'PENALIZED' THEN
    UPDATE public.profiles
       SET verification_status = coalesce(nullif(previous_status, ''), 'GUEST'),
           moderation_message = NULL,
           moderation_previous_status = NULL,
           penalty_until = NULL
     WHERE device_id = NEW.device_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_report_moderation_before_insert ON public.reports;

CREATE TRIGGER enforce_report_moderation_before_insert
BEFORE INSERT ON public.reports
FOR EACH ROW
EXECUTE FUNCTION public.enforce_report_moderation();
