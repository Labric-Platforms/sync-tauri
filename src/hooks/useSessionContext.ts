import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SessionContext, OrgMember } from "@/types";

export function useSessionContext() {
  const [context, setContext] = useState<SessionContext | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [membersLoading, setMembersLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Compute if session is active (has either operator or metadata, and not expired)
  const hasContent =
    context != null &&
    (context.session_user_id != null ||
      (context.session_metadata != null && Object.keys(context.session_metadata).length > 0));
  const isActive =
    hasContent &&
    (context!.expires_at == null || context!.expires_at > Date.now());

  // Tick every minute so the countdown updates
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isActive || context?.expires_at == null) return;
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [isActive, context?.expires_at]);

  // Time remaining in ms
  const timeRemaining =
    isActive && context?.expires_at != null
      ? Math.max(0, context.expires_at - Date.now())
      : null;

  // Load initial context
  useEffect(() => {
    (async () => {
      try {
        setIsLoading(true);
        const ctx = await invoke<SessionContext>("get_session_context");
        setContext(ctx);
      } catch (err) {
        setError(err as string);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // Auto-clear on expiry
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (context?.expires_at != null && hasContent) {
      const remaining = context.expires_at - Date.now();
      if (remaining <= 0) {
        // Already expired, clear
        invoke("clear_session_context").then(() => {
          setContext({ session_user_id: null, session_metadata: null, expires_at: null });
        });
      } else {
        timerRef.current = setTimeout(() => {
          invoke("clear_session_context").then(() => {
            setContext({ session_user_id: null, session_metadata: null, expires_at: null });
          });
        }, remaining);
      }
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [context?.expires_at, hasContent]);

  const loadMembers = useCallback(async (search?: string) => {
    try {
      setMembersLoading(true);
      const result = await invoke<OrgMember[]>("get_org_members", {
        search: search || null,
      });
      setMembers(result);
    } catch (err) {
      console.error("Failed to load org members:", err);
    } finally {
      setMembersLoading(false);
    }
  }, []);

  const updateSessionContext = useCallback(async (ctx: SessionContext) => {
    try {
      await invoke("set_session_context", { context: ctx });
      setContext(ctx);
      setError(null);
    } catch (err) {
      setError(err as string);
      throw err;
    }
  }, []);

  const clearContext = useCallback(async () => {
    try {
      await invoke("clear_session_context");
      setContext({ session_user_id: null, session_metadata: null, expires_at: null });
      setError(null);
    } catch (err) {
      setError(err as string);
      throw err;
    }
  }, []);

  return {
    context,
    members,
    isActive,
    timeRemaining,
    isLoading,
    membersLoading,
    error,
    loadMembers,
    updateSessionContext,
    clearContext,
  };
}
