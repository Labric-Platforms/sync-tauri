import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getAccessToken } from '@/lib/store';

interface HeartbeatResponse {
  status: string;
  first_seen: string;
  last_seen: string;
  app_version: string;
}

interface HeartbeatStatus {
  status: HeartbeatResponse | null;
  is_loading: boolean;
  error: string | null;
}

export function useHeartbeat(url: string) {
  const [heartbeatState, setHeartbeatState] = useState<HeartbeatStatus>({
    status: null,
    is_loading: false,
    error: null,
  });

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const initializeHeartbeat = async () => {
      try {
        const token = await getAccessToken();
        if (!token) {
          console.log('No token available, skipping heartbeat startup');
          return;
        }

        setHeartbeatState(prev => ({ ...prev, is_loading: true, error: null }));
        
        // Start the service and listen for updates simultaneously
        const [, unlistenFn] = await Promise.all([
          invoke('start_heartbeat_service', { url, token }),
          listen<HeartbeatStatus>('heartbeat_status', (event) => {
            setHeartbeatState(event.payload);
          })
        ]);

        unlisten = unlistenFn;
        // Set loading to false once service is started, events will update with actual status
        setHeartbeatState(prev => ({ ...prev, is_loading: false }));
        console.log('Heartbeat service initialized successfully');
      } catch (err) {
        console.error('Failed to initialize heartbeat service:', err);
        setHeartbeatState(prev => ({
          ...prev,
          is_loading: false,
          error: err instanceof Error ? err.message : 'Unknown error'
        }));
      }
    };

    initializeHeartbeat();

    return () => {
      unlisten?.();
      invoke('stop_heartbeat_service').catch(console.error);
    };
  }, [url]);

  return heartbeatState;
}
