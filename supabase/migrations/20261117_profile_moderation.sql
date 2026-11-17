ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS moderation_message text,
  ADD COLUMN IF NOT EXISTS moderation_previous_status text,
  ADD COLUMN IF NOT EXISTS penalty_until timestamptz,
  ADD COLUMN IF NOT EXISTS verification_rejected_at timestamptz;

UPDATE public.profiles
   SET verification_rejected_at = now()
 WHERE upper(coalesce(verification_status, '')) = 'REJECTED'
   AND verification_rejected_at IS NULL;

CREATE OR REPLACE FUNCTION public.enforce_verification_rejection_cooldown()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF upper(coalesce(NEW.verification_status, '')) = 'REJECTED'
     AND upper(coalesce(OLD.verification_status, '')) <> 'REJECTED' THEN
    NEW.verification_rejected_at := now();
  ELSIF upper(coalesce(NEW.verification_status, '')) = 'PENDING'
     AND upper(coalesce(OLD.verification_status, '')) = 'REJECTED' THEN
    IF OLD.verification_rejected_at IS NOT NULL
       AND now() < OLD.verification_rejected_at + interval '7 days' THEN
      RAISE EXCEPTION 'Verification resubmission is available after %',
        OLD.verification_rejected_at + interval '7 days';
    END IF;
    NEW.verification_rejected_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_verification_rejection_cooldown_before_update ON public.profiles;

CREATE TRIGGER enforce_verification_rejection_cooldown_before_update
BEFORE UPDATE OF verification_status ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.enforce_verification_rejection_cooldown();

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS admin_notes text,
  ADD COLUMN IF NOT EXISTS response_photo text,
  ADD COLUMN IF NOT EXISTS progress_photo text;

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

NOTIFY pgrst, 'reload schema';
