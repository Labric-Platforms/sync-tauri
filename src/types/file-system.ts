export interface FileChangeEvent {
  path: string;
  event_type: string;
  timestamp: number;
  upload_status?: 'pending' | 'queued' | 'uploading' | 'uploaded' | 'failed' | 'ignored';
} 