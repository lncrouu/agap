ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS moderation_message text,
  ADD COLUMN IF NOT EXISTS moderation_previous_status text,
  ADD COLUMN IF NOT EXISTS penalty_until timestamptz,
  ADD COLUMN IF NOT EXISTS verification_rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS username_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS ban_appeal text,
  ADD COLUMN IF NOT EXISTS ban_appeal_status text,
  ADD COLUMN IF NOT EXISTS ban_appeal_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS ban_appeal_response text;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS admin_notes text,
  ADD COLUMN IF NOT EXISTS response_photo text,
  ADD COLUMN IF NOT EXISTS progress_photo text;

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
       AND now() < OLD.verification_rejected_at + interval '24 hours' THEN
      RAISE EXCEPTION 'Verification resubmission is available after %',
        OLD.verification_rejected_at + interval '24 hours';
    END IF;
    NEW.verification_rejected_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_username_change_cooldown()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.username IS DISTINCT FROM OLD.username THEN
    IF NEW.username IS NULL OR NEW.username !~ '^[A-Za-z0-9][A-Za-z0-9._]{1,22}[A-Za-z0-9]$' THEN
      RAISE EXCEPTION 'Username must be 3-24 characters and use only letters, numbers, dots, or underscores.';
    END IF;

    IF OLD.username_updated_at IS NOT NULL
       AND now() < OLD.username_updated_at + interval '7 days' THEN
      RAISE EXCEPTION 'Username can next be changed after %',
        OLD.username_updated_at + interval '7 days';
    END IF;

    NEW.username_updated_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_verification_rejection_cooldown_before_update ON public.profiles;
CREATE TRIGGER enforce_verification_rejection_cooldown_before_update
BEFORE UPDATE OF verification_status ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.enforce_verification_rejection_cooldown();

DROP TRIGGER IF EXISTS enforce_username_change_cooldown_before_update ON public.profiles;
CREATE TRIGGER enforce_username_change_cooldown_before_update
BEFORE UPDATE OF username ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.enforce_username_change_cooldown();

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

CREATE OR REPLACE FUNCTION public.validate_ban_appeal_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  old_appeal_status text := upper(coalesce(OLD.ban_appeal_status, ''));
  new_appeal_status text := upper(coalesce(NEW.ban_appeal_status, ''));
BEGIN
  IF new_appeal_status NOT IN ('', 'PENDING', 'APPROVED', 'DENIED') THEN
    RAISE EXCEPTION 'Invalid ban appeal status.';
  END IF;

  IF NEW.ban_appeal IS DISTINCT FROM OLD.ban_appeal
     OR (new_appeal_status = 'PENDING' AND old_appeal_status <> 'PENDING') THEN
    IF upper(coalesce(NEW.verification_status, '')) <> 'BANNED' THEN
      RAISE EXCEPTION 'Only a banned device can submit a ban appeal.';
    END IF;

    IF old_appeal_status = 'PENDING' THEN
      RAISE EXCEPTION 'An appeal is already pending review.';
    END IF;

    IF NEW.ban_appeal IS NULL
       OR char_length(btrim(NEW.ban_appeal)) < 30
       OR char_length(btrim(NEW.ban_appeal)) > 2000 THEN
      RAISE EXCEPTION 'A ban appeal must contain between 30 and 2000 characters.';
    END IF;

    NEW.ban_appeal_status := 'PENDING';
    NEW.ban_appeal_submitted_at := now();
    NEW.ban_appeal_response := NULL;
  END IF;

  IF new_appeal_status = 'APPROVED'
     AND upper(coalesce(NEW.verification_status, '')) = 'BANNED' THEN
    RAISE EXCEPTION 'Approving a ban appeal must also lift the ban.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_ban_appeal_before_update ON public.profiles;
CREATE TRIGGER validate_ban_appeal_before_update
BEFORE UPDATE OF ban_appeal, ban_appeal_status ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.validate_ban_appeal_update();

NOTIFY pgrst, 'reload schema';
