import { useState, useEffect, useRef } from "react";
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
  Loader2,
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

import { FileChangeEvent, FileUploadStatus } from "@/types";
import UploadSettingsSheet from "./UploadSettingsDialog";
import { getRecentDirs, pushRecent } from "@/lib/store";

export default function Simple() {
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
      setUploadStatuses(
        (prev) =>
          new Map(prev.set(uploadStatus.relative_path, uploadStatus.status))
      );
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

  function formatTimestamp(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleTimeString();
  }

  function getRelativePath(absolutePath: string): string {
    if (!selectedFolder || !absolutePath.startsWith(selectedFolder)) {
      return absolutePath;
    }

    const relativePath = absolutePath.slice(selectedFolder.length);
    // Remove leading slash/backslash if present
    return relativePath.startsWith("/") || relativePath.startsWith("\\")
      ? relativePath.slice(1)
      : relativePath;
  }

  function getDirectoryName(path: string): string {
    return path;
  }

  function truncatePathFromStart(path: string, maxLength: number = 35): string {
    if (path.length <= maxLength) {
      return path;
    }
    return "..." + path.slice(-(maxLength - 3));
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function getUploadStatus(
    filePath: string
  ): FileUploadStatus["status"] | undefined {
    const relativePath = getRelativePath(filePath);
    return uploadStatuses.get(relativePath);
  }

  function getUploadStatusIcon(status: FileUploadStatus["status"] | undefined) {
    if (!status) return null;

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
        className: "text-green-500",
      },
      failed: {
        icon: XCircle,
        tooltip: "Upload failed",
        className: "text-red-500",
      },
      ignored: {
        icon: EyeOff,
        tooltip: "Ignored (matches ignore pattern)",
        className: "text-muted-foreground",
      },
    };

    const config = statusConfig[status];
    const IconComponent = config.icon;

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <IconComponent className={`h-4 w-4 ${config.className}`} />
        </TooltipTrigger>
        <TooltipContent>
          <p>{config.tooltip}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  // Filter file changes based on search query
  const filteredFileChanges = fileChanges.filter((change) => {
    if (!searchQuery.trim()) return true;
    const relativePath = getRelativePath(change.path);
    return relativePath.toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <main className="container mx-auto p-6 max-w-4xl">
      <div className="space-y-8 mt-6 max-w-lg mx-auto">
        {/* Folder Selection */}
        {!selectedFolder ? (
          <Button onClick={selectFolder} className="w-full">
            Select Folder
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button onClick={selectFolder} className="flex-1">
              Change Folder
            </Button>
            <Button onClick={stopWatching} variant="outline" className="flex-1">
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
            <div className="flex flex-col gap-2 items-start">
              {recentDirs.map((dir, index) => (
                <button
                  key={`${dir}-${index}`}
                  onClick={() => selectRecentFolder(dir)}
                  className="text-xs text-muted-foreground hover:underline"
                  title={dir}
                >
                  {getDirectoryName(dir)}
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

              <p className="text-sm font-semibold break-all">
                {selectedFolder}
              </p>
            </div>
          </div>
        )}

        {/* File Changes */}
        {selectedFolder && (
          <>
            <h3 className="text-lg font-semibold m-0 mt-8 mb-2">Logs</h3>
            <div
              ref={logsRef}
              className="sticky top-0 bg-background m-0 mb-2 space-y-3 py-2 z-40"
            >
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search logs..."
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 rounded-full"
                />
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
                filteredFileChanges.map((change, index) => (
                  <div
                    key={`${change.path}-${change.timestamp}-${index}`}
                    className="flex items-center py-2 w-full"
                  >
                    <div className="flex-1 min-w-0 pr-3">
                      <p
                        className="text-sm truncate"
                        title={getRelativePath(change.path)}
                      >
                        {truncatePathFromStart(getRelativePath(change.path))}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {getUploadStatusIcon(getUploadStatus(change.path))}
                      <span className="text-xs text-muted-foreground whitespace-nowrap font-mono">
                        {formatTimestamp(change.timestamp)}
                      </span>
                      {/* <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="h-6 w-6 rounded-sm hover:bg-muted flex items-center justify-center">
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem>
                            <Copy className="mr-2 h-4 w-4" />
                            Copy Path
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <FolderOpen className="mr-2 h-4 w-4" />
                            Open in Finder
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem>
                            <RotateCcw className="mr-2 h-4 w-4" />
                            Retry Upload
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu> */}
                    </div>
                  </div>
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
              <div className="flex items-center space-x-1.5">
                <div
                  className={`w-2 h-2 rounded-full ${
                    heartbeatStatus?.status?.status === "online"
                      ? "bg-green-500"
                      : "bg-red-500"
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
          <span>
            {(() => {
              const actualChanges = fileChanges.filter(
                (change) => change.event_type !== "initial"
              ).length;
              return actualChanges >= 500 ? "500+" : actualChanges;
            })()}{" "}
            changes detected
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
