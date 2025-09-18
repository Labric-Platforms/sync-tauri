import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { UploadConfig, UploadProgress } from '@/types';

export function useUploadManager() {
  const [config, setConfig] = useState<UploadConfig | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [queueSize, setQueueSize] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load initial configuration and progress
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        setIsLoading(true);
        const [uploadConfig, uploadProgress, currentQueueSize] = await Promise.all([
          invoke<UploadConfig>('get_upload_config'),
          invoke<UploadProgress>('get_upload_progress'),
          invoke<number>('get_queue_size'),
        ]);
        
        setConfig(uploadConfig);
        setProgress(uploadProgress);
        setQueueSize(currentQueueSize);
        setError(null);
      } catch (err) {
        setError(err as string);
        console.error('Failed to load upload data:', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadInitialData();
  }, []);

  // Listen for upload events
  useEffect(() => {
    const unlistenPromises = [
      listen('upload_progress', (event) => {
        const progressData = event.payload as UploadProgress;
        setProgress(progressData);
        setQueueSize(progressData.total_queued);
      }),
      listen('upload_success', (event) => {
        console.log('File uploaded successfully:', event.payload);
      }),
      listen('upload_failed', (event) => {
        console.error('File upload failed:', event.payload);
      }),
      listen('file_uploaded', (event) => {
        console.log('File upload completed:', event.payload);
      }),
    ];

    return () => {
      Promise.all(unlistenPromises).then((unlistenFunctions) => {
        unlistenFunctions.forEach((unlisten) => unlisten());
      });
    };
  }, []);

  // Update upload configuration
  const updateConfig = useCallback(async (newConfig: UploadConfig) => {
    try {
      await invoke('set_upload_config', { config: newConfig });
      setConfig(newConfig);
      setError(null);
    } catch (err) {
      setError(err as string);
      throw err;
    }
  }, []);

  // Clear upload queue
  const clearQueue = useCallback(async () => {
    try {
      await invoke('clear_upload_queue');
      setQueueSize(0);
      if (progress) {
        setProgress({ ...progress, total_queued: 0 });
      }
      setError(null);
    } catch (err) {
      setError(err as string);
      throw err;
    }
  }, [progress]);

  // Trigger manual upload
  const triggerManualUpload = useCallback(async (filePath: string, basePath: string) => {
    try {
      await invoke('trigger_manual_upload', { filePath, basePath });
      setError(null);
    } catch (err) {
      setError(err as string);
      throw err;
    }
  }, []);

  // Toggle upload functionality
  const toggleUploads = useCallback(async (enabled: boolean) => {
    if (!config) return;
    
    const newConfig = { ...config, enabled };
    await updateConfig(newConfig);
  }, [config, updateConfig]);

  // Add or remove ignored pattern
  const updateIgnoredPatterns = useCallback(async (patterns: string[]) => {
    if (!config) return;
    
    const newConfig = { ...config, ignored_patterns: patterns };
    await updateConfig(newConfig);
  }, [config, updateConfig]);

  // Update server URL
  const updateServerUrl = useCallback(async (serverUrl: string) => {
    if (!config) return;
    
    const newConfig = { ...config, server_url: serverUrl };
    await updateConfig(newConfig);
  }, [config, updateConfig]);

  // Update upload delay
  const updateUploadDelay = useCallback(async (delayMs: number) => {
    if (!config) return;
    
    const newConfig = { ...config, upload_delay_ms: delayMs };
    await updateConfig(newConfig);
  }, [config, updateConfig]);

  // Toggle ignore existing files
  const toggleIgnoreExistingFiles = useCallback(async (ignore: boolean) => {
    if (!config) return;
    
    const newConfig = { ...config, ignore_existing_files: ignore };
    await updateConfig(newConfig);
  }, [config, updateConfig]);

  return {
    config,
    progress,
    queueSize,
    isLoading,
    error,
    updateConfig,
    clearQueue,
    triggerManualUpload,
    toggleUploads,
    toggleIgnoreExistingFiles,
    updateIgnoredPatterns,
    updateServerUrl,
    updateUploadDelay,
  };
} 