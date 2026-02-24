import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://sjjxlabvdzihqyadquip.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqanhsYWJ2ZHppaHF5YWRxdWlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ0MDA3NDMsImV4cCI6MjA2OTk3Njc0M30.CvZ50a2dVbv63l8A2ADNNxF9Rab-QMk1rcBv_ZF-UXc"; // público (ok no front)

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);