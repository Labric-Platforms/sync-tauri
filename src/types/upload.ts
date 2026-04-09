export interface UploadConfig {
  enabled: boolean;
  server_url: string;
  ignored_patterns: string[];
  upload_delay_ms: number;
  max_concurrent_uploads: number;
  ignore_existing_files: boolean;
}

export interface UploadProgress {
  total_queued: number;
  total_uploaded: number;
  total_failed: number;
  in_flight: number;
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

export interface FileUploadStatus {
  relative_path: string;
  status: 'pending' | 'queued' | 'uploading' | 'uploaded' | 'failed' | 'ignored' | 'directory';
  error?: string;
}

export interface SessionContext {
  session_user_id: string | null;
  session_metadata: Record<string, string> | null;
  expires_at: number | null; // Unix timestamp in millis
}

export interface OrgMember {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  image_url: string | null;
}