CREATE TABLE public.badges (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  badge_url text,
  CONSTRAINT badges_pkey PRIMARY KEY (id)
);
CREATE TABLE public.friend_edges (
  a uuid NOT NULL,
  b uuid NOT NULL,
  requested_by uuid NOT NULL,
  state USER-DEFINED NOT NULL DEFAULT 'pending'::friend_state,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT friend_edges_pkey PRIMARY KEY (a, b)
);
CREATE TABLE public.friend_invites (
  code text NOT NULL,
  inviter_id uuid NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  redeemed_by uuid,
  redeemed_at timestamp with time zone,
  used boolean NOT NULL DEFAULT false,
  CONSTRAINT friend_invites_pkey PRIMARY KEY (code)
);
CREATE TABLE public.profiles (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  auth_id uuid NOT NULL DEFAULT auth.uid() UNIQUE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  username text NOT NULL UNIQUE,
  settings jsonb,
  bio text,
  badge_id bigint,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_auth_id_fkey FOREIGN KEY (auth_id) REFERENCES auth.users(id),
  CONSTRAINT profiles_badge_id_fkey FOREIGN KEY (badge_id) REFERENCES public.badges(id)
);
CREATE TABLE public.worms (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  content text NOT NULL,
  status text NOT NULL DEFAULT 'draft'::text,
  tags ARRAY NOT NULL DEFAULT '{}'::text[],
  author_id bigint,
  position jsonb NOT NULL,
  host_url text,
  CONSTRAINT worms_pkey PRIMARY KEY (id),
  CONSTRAINT annotations_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id)
);