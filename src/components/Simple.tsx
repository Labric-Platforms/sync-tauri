import { useState, useEffect, useRef, useMemo, useCallback, memo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Settings2Icon,
  // MoreVertical,
  // Copy,
  // FolderOpen,
  // RotateCcw,
  Clock,
  ListEnd,
  CheckCircle,
  XCircle,
  EyeOff,
  Folder,
  Loader2,
  CloudCheck,
  ArrowUp,
  Search,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
// import {
//   DropdownMenu,
//   DropdownMenuContent,
//   DropdownMenuItem,
//   DropdownMenuSeparator,
//   DropdownMenuTrigger,
// } from "@/components/ui/dropdown-menu";

import { toast } from "sonner";
import { FileChangeEvent, FileUploadStatus } from "@/types";
import { useUploadManager } from "@/hooks/useUploadManager";
import UploadSettingsSheet from "./UploadSettingsDialog";
import { getRecentDirs, pushRecent } from "@/lib/store";

const statusConfig = {
  pending: {
    icon: Clock,
    tooltip: "Waiting for batched changes",
    className: "text-muted-foreground",
  },
  queued: {
    icon: ListEnd,
    tooltip: "Queued for upload",
    className: "text-muted-foreground",
  },
  uploading: {
    icon: Loader2,
    tooltip: "Currently uploading...",
    className: "text-muted-foreground animate-spin",
  },
  uploaded: {
    icon: CheckCircle,
    tooltip: "Successfully uploaded",
    className: "text-success",
  },
  failed: {
    icon: XCircle,
    tooltip: "Upload failed",
    className: "text-destructive",
  },
  ignored: {
    icon: EyeOff,
    tooltip: "Ignored (matches ignore pattern)",
    className: "text-muted-foreground",
  },
  directory: {
    icon: Folder,
    tooltip: "Directory",
    className: "text-muted-foreground",
  },
} as const;

function getRelativePathFromFolder(absolutePath: string, folder: string): string {
  if (!folder || !absolutePath.startsWith(folder)) return absolutePath;
  const relativePath = absolutePath.slice(folder.length);
  return relativePath.startsWith("/") || relativePath.startsWith("\\")
    ? relativePath.slice(1)
    : relativePath;
}

function truncatePath(path: string, maxLength: number = 35): string {
  if (path.length <= maxLength) return path;
  return "..." + path.slice(-(maxLength - 3));
}

const FileChangeRow = memo(function FileChangeRow({
  change,
  status,
  selectedFolder,
}: {
  change: FileChangeEvent;
  status: FileUploadStatus["status"] | undefined;
  selectedFolder: string;
}) {
  const relativePath = getRelativePathFromFolder(change.path, selectedFolder);
  const StatusIcon = status ? statusConfig[status].icon : null;
  const statusMeta = status ? statusConfig[status] : null;

  return (
    <div className="flex items-center py-2 w-full">
      <div className="flex-1 min-w-0 pr-3">
        <p className="text-sm truncate" title={relativePath}>
          {truncatePath(relativePath)}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {StatusIcon && statusMeta && (
          <Tooltip>
            <TooltipTrigger asChild>
              <StatusIcon className={`h-4 w-4 ${statusMeta.className}`} />
            </TooltipTrigger>
            <TooltipContent>
              <p>{statusMeta.tooltip}</p>
            </TooltipContent>
          </Tooltip>
        )}
        <span className="text-xs text-muted-foreground whitespace-nowrap font-mono">
          {new Date(change.timestamp * 1000).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
});

export default function Simple() {
  const { progress } = useUploadManager();
  const [selectedFolder, setSelectedFolder] = useState("");
  const [fileChanges, setFileChanges] = useState<FileChangeEvent[]>([]);
  // Removed isOnline state as it's no longer needed with Rust backend
  const [recentDirs, setRecentDirs] = useState<string[]>([]);
  const [heartbeatStatus, setHeartbeatStatus] = useState<any>(null);
  const [uploadStatuses, setUploadStatuses] = useState<
    Map<string, FileUploadStatus["status"]>
  >(new Map());
  const [showScrollToTop, setShowScrollToTop] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const logsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Listen for file change events from Tauri
    const unlistenFileChange = listen("file_change", (event) => {
      console.log("file_change", event);
      const fileChange = event.payload as FileChangeEvent;
      setFileChanges((prev) => {
        // Remove any existing entries for this file path
        const filteredPrev = prev.filter(
          (change) => change.path !== fileChange.path
        );
        // Add the new change at the beginning (most recent)
        const updated = [fileChange, ...filteredPrev];
        // Keep only latest 500 changes
        return updated.slice(0, 500);
      });
    });

    // Listen for heartbeat status events from Rust backend
    const unlistenHeartbeat = listen("heartbeat_status", (event) => {
      console.log("heartbeat_status", event);
      setHeartbeatStatus(event.payload);
    });

    // Listen for file upload status events
    const unlistenUploadStatus = listen("file_upload_status", (event) => {
      console.log("file_upload_status", event);
      const uploadStatus = event.payload as FileUploadStatus;
      setUploadStatuses((prev) => {
        const next = new Map(prev);
        next.set(uploadStatus.relative_path, uploadStatus.status);
        // Cap at 1000 entries to prevent unbounded memory growth
        if (next.size > 1000) {
          const firstKey = next.keys().next().value;
          if (firstKey !== undefined) next.delete(firstKey);
        }
        return next;
      });
    });

    return () => {
      unlistenFileChange.then((fn) => fn());
      unlistenHeartbeat.then((fn) => fn());
      unlistenUploadStatus.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    // Load recent directories on mount
    loadRecentDirs();
  }, []);

  useEffect(() => {
    // Handle scroll to show/hide scroll-to-top button
    const handleScroll = () => {
      // Show button if user has scrolled down more than 200px
      setShowScrollToTop(window.scrollY > 200);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  async function loadRecentDirs() {
    try {
      const recent = await getRecentDirs();
      setRecentDirs(recent);
    } catch (err) {
      console.error("Failed to load recent directories:", err);
    }
  }

  async function selectFolder() {
    try {
      const folderPath = await open({
        directory: true,
        multiple: false,
      });

      if (folderPath) {
        await selectAndWatchFolder(folderPath as string);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function selectAndWatchFolder(folderPath: string) {
    try {
      // Stop watching previous folder if any
      if (selectedFolder) {
        await stopWatching();
      }

      setSelectedFolder(folderPath);
      setFileChanges([]); // Clear previous changes

      // Add to recent directories
      await pushRecent(folderPath);
      await loadRecentDirs(); // Refresh the recent dirs list

      // Automatically start watching the new folder
      try {
        await invoke("start_watching", { folderPath });
      } catch (err) {
        console.error("Failed to start watching:", err);
      }
    } catch (err) {
      console.error("Failed to select folder:", err);
    }
  }

  async function selectRecentFolder(folderPath: string) {
    await selectAndWatchFolder(folderPath);
  }

  async function stopWatching() {
    try {
      await invoke("stop_watching");
      setSelectedFolder("");
      setFileChanges([]);
    } catch (err) {
      console.error("Failed to stop watching:", err);
    }
  }

  function getRelativePath(absolutePath: string): string {
    return getRelativePathFromFolder(absolutePath, selectedFolder);
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const getUploadStatus = useCallback(
    (filePath: string): FileUploadStatus["status"] | undefined => {
      const relativePath = getRelativePath(filePath);
      return uploadStatuses.get(relativePath);
    },
    [uploadStatuses, selectedFolder]
  );

  // Filter file changes based on search query
  const filteredFileChanges = useMemo(() => {
    if (!searchQuery.trim()) return fileChanges;
    const query = searchQuery.toLowerCase();
    return fileChanges.filter((change) => {
      const relativePath = getRelativePath(change.path);
      return relativePath.toLowerCase().includes(query);
    });
  }, [fileChanges, searchQuery, selectedFolder]);

  return (
    <main className="container mx-auto p-6 max-w-4xl">
      <div className="space-y-8 mt-6 max-w-lg mx-auto">
        {/* Folder Selection */}
        {!selectedFolder ? (
          <Button onClick={selectFolder} size="lg" className="w-full rounded-full">
            Select Folder
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button onClick={selectFolder} size="lg" className="flex-1 rounded-full">
              Change Folder
            </Button>
            <Button onClick={stopWatching} variant="destructive" size="lg" className="flex-1 rounded-full">
              Stop
            </Button>
          </div>
        )}

        {/* Recent Directories */}
        {recentDirs.length > 0 && !selectedFolder && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              Recent folders
            </p>
            <div className="flex flex-col gap-2 items-start w-full">
              {recentDirs.map((dir, index) => (
                <button
                  key={`${dir}-${index}`}
                  onClick={() => selectRecentFolder(dir)}
                  className="text-xs text-muted-foreground hover:underline text-left"
                  title={dir}
                >
                  {dir}
                </button>
              ))}
            </div>
          </div>
        )}

        {selectedFolder && (
          <div className="space-y-3">
            <div className="">
              <p className="text-xs text-muted-foreground mb-1">
                Currently watching
              </p>

              <span
                className="text-sm break-all cursor-copy inline"
                onClick={() => {
                  navigator.clipboard.writeText(selectedFolder);
                  toast.success("Copied to clipboard");
                }}
                title="Click to copy path"
              >
                {selectedFolder}
              </span>
            </div>
          </div>
        )}

        {/* File Changes */}
        {selectedFolder && (
          <>
            <div
              ref={logsRef}
              className="sticky top-0 m-0 space-y-3 my-2 pb-2 z-40"
            >
              <div className="relative rounded-full bg-background">
                <div className="flex flex-col border dark:border-none rounded-full px-4 py-3 shadow-sm dark:bg-input/30">
                  <div className="flex items-center gap-2">

                    <Search className="text-muted-foreground h-4 w-4 flex-shrink-0 ml-1" />
                    <Input
                      placeholder="Search logs..."
                      autoFocus
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full border-none shadow-none leading-snug focus-visible:ring-0 !bg-transparent h-auto py-0"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-1 mb-8">
              {filteredFileChanges.length === 0 ? (
                <p className="text-muted-foreground text-center text-sm py-4">
                  {fileChanges.length === 0
                    ? "No files found"
                    : "No files match your search"}
                </p>
              ) : (
                filteredFileChanges.map((change) => (
                  <FileChangeRow
                    key={change.path}
                    change={change}
                    status={getUploadStatus(change.path)}
                    selectedFolder={selectedFolder}
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>

      {/* VS Code Style Status Ribbon */}
      <div className="fixed bottom-0 left-0 right-0 bg-background border-t text-xs px-4 py-0.25 flex items-center justify-between z-50">
        <div className="flex items-center space-x-4">
          <Tooltip>
            <TooltipTrigger>
              <div className="flex items-center space-x-2">
                <div
                  className={`w-2 h-2 rounded-full ${heartbeatStatus?.status?.status === "online"
                      ? "bg-success"
                      : "bg-destructive"
                    }`}
                ></div>
                <span>
                  {heartbeatStatus?.status?.status === "online"
                    ? "Connected"
                    : "Disconnected"}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent collisionPadding={8}>
              {heartbeatStatus?.status?.status === "online" ? (
                <>
                  <span>Online since</span>{" "}
                  {new Date(heartbeatStatus?.status?.first_seen).toLocaleString(
                    undefined,
                    { dateStyle: "short", timeStyle: "short" }
                  )}
                </>
              ) : heartbeatStatus?.status?.last_seen ? (
                <>
                  <span>Offline since</span>{" "}
                  {new Date(heartbeatStatus?.status?.last_seen).toLocaleString(
                    undefined,
                    { dateStyle: "short", timeStyle: "short" }
                  )}
                </>
              ) : (
                <>
                  <span>Offline</span>
                </>
              )}
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center space-x-4">
          <span className="flex items-center gap-2">
            {(() => {
              const pending = (progress?.total_queued ?? 0) + (progress?.in_flight ?? 0);
              if (pending > 0) {
                return <><Loader2 className="h-3 w-3 animate-spin" /><span>Syncing <span className="font-mono tabular-nums">{pending}</span> file{pending === 1 ? "" : "s"}</span></>;
              }
              return <><CloudCheck className="h-3 w-3" /><span>Up to date</span></>;
            })()}
          </span>
          <UploadSettingsSheet>
            <button className="hover:bg-muted p-1 rounded">
              <Settings2Icon className="w-3 h-3" />
            </button>
          </UploadSettingsSheet>
        </div>
      </div>

      {/* Scroll to Top FAB */}
      {showScrollToTop && (
        <Button
          onClick={scrollToTop}
          variant="outline"
          className="fixed bottom-8 right-6 rounded-full z-40"
          size="icon"
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
      )}
    </main>
  );
}
