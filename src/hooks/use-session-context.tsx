import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SessionContext, OrgMember } from "@/types";

interface SessionContextValue {
  context: SessionContext | null;
  members: OrgMember[];
  isActive: boolean;
  timeRemaining: number | null;
  isLoading: boolean;
  membersLoading: boolean;
  error: string | null;
  loadMembers: (search?: string) => Promise<void>;
  updateSessionContext: (ctx: SessionContext) => Promise<void>;
  clearContext: () => Promise<void>;
}

const SessionContextReact = createContext<SessionContextValue | null>(null);

export function SessionContextProvider({ children }: { children: ReactNode }) {
  const [context, setContext] = useState<SessionContext | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [membersLoading, setMembersLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasContent =
    context != null &&
    (context.session_user_id != null ||
      (context.session_metadata != null && Object.keys(context.session_metadata).length > 0));
  const isActive =
    hasContent &&
    (context!.expires_at == null || context!.expires_at > Date.now());

  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isActive || context?.expires_at == null) return;
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [isActive, context?.expires_at]);

  const timeRemaining =
    isActive && context?.expires_at != null
      ? Math.max(0, context.expires_at - Date.now())
      : null;

  // Initial fetch + subscribe to backend changes
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

    const unlisten = listen<SessionContext>("session_context_changed", (event) => {
      setContext(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Auto-clear on expiry — backend command will emit, which updates state
  useEffect(() => {
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);

    if (context?.expires_at != null && hasContent) {
      const remaining = context.expires_at - Date.now();
      if (remaining <= 0) {
        invoke("clear_session_context").catch(() => {});
      } else {
        expiryTimerRef.current = setTimeout(() => {
          invoke("clear_session_context").catch(() => {});
        }, remaining);
      }
    }

    return () => {
      if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
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
      setError(null);
    } catch (err) {
      setError(err as string);
      throw err;
    }
  }, []);

  const clearContext = useCallback(async () => {
    try {
      await invoke("clear_session_context");
      setError(null);
    } catch (err) {
      setError(err as string);
      throw err;
    }
  }, []);

  const value: SessionContextValue = {
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

  return <SessionContextReact.Provider value={value}>{children}</SessionContextReact.Provider>;
}

export function useSessionContext() {
  const ctx = useContext(SessionContextReact);
  if (!ctx) {
    throw new Error("useSessionContext must be used within a SessionContextProvider");
  }
  return ctx;
}
