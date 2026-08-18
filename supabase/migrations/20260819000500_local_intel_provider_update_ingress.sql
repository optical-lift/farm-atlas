-- Elm Directory: provider-push current-state ingress
-- Applied to live Noel/Elm Supabase on 2026-08-18.
--
-- Governing rule:
-- Provider messages may change only authorized current-state lanes. They do not grant
-- permission to rewrite durable directory identity, category, address, or profile truth.
-- Raw provider language is retained; structured candidates must carry explicit validity
-- windows; only verified channels and approved candidates may become live assertions.
--
-- IMPORTANT REPOSITORY HISTORY NOTE
-- The live local_intel schema predates the local migration history currently present
-- in this repository. This is a forward migration against the existing Elm local_intel
-- baseline; it is not a clean-bootstrap definition of that baseline.

DO $$
BEGIN
  IF to_regclass('local_intel.entities') IS NULL
     OR to_regclass('local_intel.availability_assertions') IS NULL THEN
    RAISE EXCEPTION 'Elm local_intel baseline and live availability contract are required before provider update ingress';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS local_intel.provider_update_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES local_intel.entities(id) ON DELETE CASCADE,
  channel_type text NOT NULL,
  sender_identifier text NOT NULL,
  display_label text,
  status text NOT NULL DEFAULT 'pending_verification',
  verified_at timestamptz,
  revoked_at timestamptz,
  allowed_availability_kinds text[] NOT NULL DEFAULT '{}'::text[],
  reporting_timezone text NOT NULL DEFAULT 'America/Chicago',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_update_channels_status_chk CHECK (status IN ('pending_verification','verified','revoked')),
  CONSTRAINT provider_update_channels_type_chk CHECK (channel_type IN ('sms','whatsapp','email','manual')),
  CONSTRAINT provider_update_channels_verified_chk CHECK ((status <> 'verified') OR verified_at IS NOT NULL),
  UNIQUE(channel_type,sender_identifier)
);

ALTER TABLE local_intel.provider_update_channels
  ADD COLUMN IF NOT EXISTS reporting_timezone text NOT NULL DEFAULT 'America/Chicago';
ALTER TABLE local_intel.provider_update_channels ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS provider_update_channels_entity_idx
  ON local_intel.provider_update_channels(entity_id,status);

CREATE TABLE IF NOT EXISTS local_intel.provider_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid REFERENCES local_intel.provider_update_channels(id) ON DELETE SET NULL,
  channel_type text NOT NULL,
  sender_identifier text NOT NULL,
  provider_message_key text,
  body text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processing_state text NOT NULL DEFAULT 'received',
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_messages_processing_state_chk CHECK (processing_state IN ('received','unlinked','parsed','needs_review','applied','ignored','failed')),
  CONSTRAINT provider_messages_nonempty_body_chk CHECK (length(btrim(body)) > 0)
);

ALTER TABLE local_intel.provider_messages ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS provider_messages_external_key_uidx
  ON local_intel.provider_messages(channel_type,provider_message_key)
  WHERE provider_message_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS provider_messages_channel_received_idx
  ON local_intel.provider_messages(channel_id,received_at DESC);
CREATE INDEX IF NOT EXISTS provider_messages_sender_received_idx
  ON local_intel.provider_messages(channel_type,sender_identifier,received_at DESC);

CREATE TABLE IF NOT EXISTS local_intel.provider_update_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES local_intel.provider_messages(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES local_intel.entities(id) ON DELETE CASCADE,
  availability_kind text NOT NULL,
  state text NOT NULL,
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  valid_from timestamptz NOT NULL,
  valid_through timestamptz NOT NULL,
  expiry_basis text NOT NULL,
  confidence numeric(5,4) NOT NULL DEFAULT 0,
  review_state text NOT NULL DEFAULT 'needs_review',
  parser_version text,
  assertion_id uuid REFERENCES local_intel.availability_assertions(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_update_candidates_window_chk CHECK (valid_through > valid_from),
  CONSTRAINT provider_update_candidates_confidence_chk CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT provider_update_candidates_review_state_chk CHECK (review_state IN ('needs_review','approved','auto_approved','rejected','applied')),
  UNIQUE(message_id,availability_kind)
);

ALTER TABLE local_intel.provider_update_candidates ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS provider_update_candidates_review_idx
  ON local_intel.provider_update_candidates(review_state,created_at);
CREATE INDEX IF NOT EXISTS provider_update_candidates_entity_idx
  ON local_intel.provider_update_candidates(entity_id,availability_kind,created_at DESC);

COMMENT ON TABLE local_intel.provider_update_channels IS
  'Verified provider-controlled update channels. A channel grants permission to report only current-state lanes explicitly assigned to that provider; it is not permission to rewrite directory identity/profile truth.';
COMMENT ON COLUMN local_intel.provider_update_channels.reporting_timezone IS
  'IANA timezone used to resolve provider phrases such as today, tomorrow, and this week into explicit timestamptz validity windows before application.';
COMMENT ON TABLE local_intel.provider_messages IS
  'Immutable inbound provider updates. Raw provider language is retained even when extraction is ambiguous, rejected, or later superseded.';
COMMENT ON TABLE local_intel.provider_update_candidates IS
  'Structured candidate current-state assertions extracted from provider messages. Candidates require explicit validity windows and may only become live assertions through a verified authorized provider channel.';

CREATE OR REPLACE FUNCTION local_intel.apply_provider_availability_candidate_v1(p_candidate_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = local_intel, public
AS $$
DECLARE
  v_candidate local_intel.provider_update_candidates%rowtype;
  v_message local_intel.provider_messages%rowtype;
  v_channel local_intel.provider_update_channels%rowtype;
  v_assertion_id uuid;
BEGIN
  SELECT * INTO v_candidate
  FROM local_intel.provider_update_candidates
  WHERE id=p_candidate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider update candidate % not found', p_candidate_id;
  END IF;

  IF v_candidate.review_state NOT IN ('approved','auto_approved') THEN
    RAISE EXCEPTION 'Candidate % is not approved for application (state=%)', p_candidate_id, v_candidate.review_state;
  END IF;

  SELECT * INTO v_message
  FROM local_intel.provider_messages
  WHERE id=v_candidate.message_id;

  IF v_message.channel_id IS NULL THEN
    RAISE EXCEPTION 'Provider message % is not linked to a verified channel', v_message.id;
  END IF;

  SELECT * INTO v_channel
  FROM local_intel.provider_update_channels
  WHERE id=v_message.channel_id;

  IF v_channel.status <> 'verified' OR v_channel.verified_at IS NULL OR v_channel.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Provider channel % is not currently verified', v_channel.id;
  END IF;

  IF v_channel.entity_id <> v_candidate.entity_id THEN
    RAISE EXCEPTION 'Candidate entity does not match verified provider channel entity';
  END IF;

  IF NOT (v_candidate.availability_kind = ANY(v_channel.allowed_availability_kinds)) THEN
    RAISE EXCEPTION 'Provider channel % is not authorized for availability kind %', v_channel.id, v_candidate.availability_kind;
  END IF;

  INSERT INTO local_intel.availability_assertions
    (stable_key,entity_id,availability_kind,state,summary,details,observed_at,valid_from,valid_through,source_kind,confidence,metadata,updated_at)
  VALUES
    ('provider-message-' || v_message.id::text || '-' || v_candidate.availability_kind,
     v_candidate.entity_id,
     v_candidate.availability_kind,
     v_candidate.state,
     v_candidate.summary,
     v_candidate.details,
     v_message.received_at,
     v_candidate.valid_from,
     v_candidate.valid_through,
     'provider_message',
     CASE WHEN v_candidate.confidence >= 0.9 THEN 'high'
          WHEN v_candidate.confidence >= 0.7 THEN 'reported'
          ELSE 'reviewed' END,
     jsonb_build_object(
       'provider_message_id',v_message.id,
       'provider_candidate_id',v_candidate.id,
       'provider_channel_id',v_channel.id,
       'expiry_basis',v_candidate.expiry_basis,
       'parser_version',v_candidate.parser_version,
       'provider_reported',true,
       'reporting_timezone',v_channel.reporting_timezone
     ) || coalesce(v_candidate.metadata,'{}'::jsonb),
     now())
  ON CONFLICT (stable_key) DO UPDATE SET
    state=excluded.state,
    summary=excluded.summary,
    details=excluded.details,
    observed_at=excluded.observed_at,
    valid_from=excluded.valid_from,
    valid_through=excluded.valid_through,
    confidence=excluded.confidence,
    metadata=excluded.metadata,
    updated_at=now()
  RETURNING id INTO v_assertion_id;

  UPDATE local_intel.provider_update_candidates
  SET review_state='applied',assertion_id=v_assertion_id,updated_at=now()
  WHERE id=p_candidate_id;

  UPDATE local_intel.provider_messages
  SET processing_state='applied',updated_at=now()
  WHERE id=v_message.id;

  RETURN v_assertion_id;
END;
$$;

CREATE OR REPLACE VIEW local_intel.v_provider_update_inbox
WITH (security_invoker=true)
AS
SELECT pm.id AS message_id,
       pm.received_at,
       pm.channel_type,
       pm.sender_identifier,
       pm.body,
       pm.processing_state,
       puc.id AS channel_id,
       puc.status AS channel_status,
       puc.reporting_timezone,
       e.id AS entity_id,
       e.name AS entity_name,
       puc.allowed_availability_kinds,
       count(pucand.id)::int AS candidate_count,
       count(*) FILTER (WHERE pucand.review_state='needs_review')::int AS needs_review_count,
       max(pucand.updated_at) AS last_candidate_update
FROM local_intel.provider_messages pm
LEFT JOIN local_intel.provider_update_channels puc ON puc.id=pm.channel_id
LEFT JOIN local_intel.entities e ON e.id=puc.entity_id
LEFT JOIN local_intel.provider_update_candidates pucand ON pucand.message_id=pm.id
GROUP BY pm.id,pm.received_at,pm.channel_type,pm.sender_identifier,pm.body,pm.processing_state,
         puc.id,puc.status,puc.reporting_timezone,e.id,e.name,puc.allowed_availability_kinds;
