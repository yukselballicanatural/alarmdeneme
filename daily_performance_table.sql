-- ============================================================
-- DAILY_PERFORMANCE TABLOSU - Takim Lideri Gunluk Ekip Girisi
-- Supabase SQL Editor'e yapistir ve calistir
-- ============================================================

CREATE TABLE IF NOT EXISTS public.daily_performance (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,

    entry_date  date NOT NULL,
    team        text NOT NULL,
    username    text NOT NULL,
    full_name   text,

    -- 'working' | 'off'
    attendance  text DEFAULT 'working' NOT NULL,

    customers               integer DEFAULT 0,
    total_calls             integer DEFAULT 0,
    interested_patients     integer DEFAULT 0,
    sales_opportunities     integer DEFAULT 0,
    avg_talk_time           text    DEFAULT '00:00',
    consultation_completed  integer DEFAULT 0,
    offer_shared            integer DEFAULT 0,
    deals                   integer DEFAULT 0,
    same_day_payment        numeric DEFAULT 0,
    flight_tickets          integer DEFAULT 0,

    -- 'saved' | 'pending'
    status      text DEFAULT 'saved' NOT NULL,

    created_by  text,
    created_at  timestamptz DEFAULT now() NOT NULL,
    updated_at  timestamptz DEFAULT now() NOT NULL,

    UNIQUE (entry_date, username)
);

ALTER TABLE public.daily_performance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public Access" ON public.daily_performance FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS daily_performance_date_idx ON public.daily_performance(entry_date);
CREATE INDEX IF NOT EXISTS daily_performance_team_idx ON public.daily_performance(team);
CREATE INDEX IF NOT EXISTS daily_performance_username_idx ON public.daily_performance(username);
