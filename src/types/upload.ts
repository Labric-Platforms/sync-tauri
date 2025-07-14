export interface UploadConfig {
  enabled: boolean;
  server_url: string;
  ignored_patterns: string[];
  upload_delay_ms: number;
  max_concurrent_uploads: number;
}

export interface UploadProgress {
  total_queued: number;
  total_uploaded: number;
  total_failed: number;
  current_uploading: string | null;
}

export interface UploadItem {
  path: string;
  relative_path: string;
  timestamp: number;
  retry_count: number;
}

export interface UploadEvent {
  type: 'upload_progress' | 'upload_success' | 'upload_failed' | 'file_uploaded';
  payload: any;
} 