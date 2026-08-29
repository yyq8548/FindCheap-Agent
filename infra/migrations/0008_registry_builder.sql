SELECT set_config('search_path', quote_ident(current_schema()) || ', pg_catalog', true);

CREATE TABLE registry_candidates (
  candidate_kind text NOT NULL CHECK (candidate_kind IN ('OFFICIAL_STOREFRONT', 'MERCHANT_TRUST')),
  candidate_key text NOT NULL CHECK (
    length(candidate_key) BETWEEN 4 AND 253 AND
    candidate_key = lower(candidate_key) AND
    candidate_key !~ '^www\.'
  ),
  source_kind text NOT NULL CHECK (source_kind IN (
    'AWIN_JOINED_FEED',
    'SHOPIFY_CATALOG',
    'SEARCH_OBSERVATION',
    'MANUAL'
  )),
  source_reference text CHECK (source_reference IS NULL OR length(source_reference) BETWEEN 1 AND 1000),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status text NOT NULL DEFAULT 'CANDIDATE' CHECK (status IN (
    'CANDIDATE',
    'APPROVED',
    'SUSPENDED',
    'REJECTED'
  )),
  review_note text CHECK (review_note IS NULL OR length(review_note) BETWEEN 1 AND 2000),
  discovered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  PRIMARY KEY (candidate_kind, candidate_key)
);

CREATE TABLE registry_evidence (
  id bigserial PRIMARY KEY,
  candidate_kind text NOT NULL,
  candidate_key text NOT NULL,
  evidence_kind text NOT NULL CHECK (evidence_kind IN (
    'TECHNICAL_STOREFRONT',
    'BRAND_DOMAIN',
    'AUTHORIZED_RETAILER',
    'BUSINESS_IDENTITY',
    'POLICY_AND_SUPPORT',
    'MANUAL_REVIEW'
  )),
  evidence_url text NOT NULL CHECK (length(evidence_url) BETWEEN 9 AND 2000),
  result text NOT NULL CHECK (result IN ('PASS', 'FAIL', 'UNKNOWN')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  checked_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (candidate_kind, candidate_key)
    REFERENCES registry_candidates(candidate_kind, candidate_key)
    ON DELETE CASCADE,
  UNIQUE (candidate_kind, candidate_key, evidence_kind, evidence_url)
);

CREATE TABLE registry_releases (
  id bigserial PRIMARY KEY,
  version text NOT NULL UNIQUE CHECK (version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'),
  official_storefronts jsonb NOT NULL CHECK (jsonb_typeof(official_storefronts) = 'object'),
  merchant_trust jsonb NOT NULL CHECK (jsonb_typeof(merchant_trust) = 'object'),
  published_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX registry_candidates_status_idx
  ON registry_candidates (status, candidate_kind, updated_at DESC);

CREATE INDEX registry_evidence_candidate_idx
  ON registry_evidence (candidate_kind, candidate_key, checked_at DESC);

CREATE INDEX registry_releases_latest_idx
  ON registry_releases (published_at DESC, id DESC);
