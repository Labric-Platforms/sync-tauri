import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Settings2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

import { FileChangeEvent } from "@/types";
import UploadManager from "./UploadManager";
import UploadSettingsSheet from "./UploadSettingsDialog";
import { getRecentDirs, pushRecent } from "@/lib/store";

export default function Simple() {
  const [selectedFolder, setSelectedFolder] = useState("");
  const [fileChanges, setFileChanges] = useState<FileChangeEvent[]>([]);
  // Removed isOnline state as it's no longer needed with Rust backend
  const [recentDirs, setRecentDirs] = useState<string[]>([]);
  const [heartbeatStatus, setHeartbeatStatus] = useState<any>(null);
  useEffect(() => {
    // Listen for file change events from Tauri
    const unlistenFileChange = listen("file_change", (event) => {
      console.log("file_change", event);
      const fileChange = event.payload as FileChangeEvent;
      setFileChanges((prev) => [fileChange, ...prev].slice(0, 100)); // Keep only latest 100 changes
    });

    // Listen for heartbeat status events from Rust backend
    const unlistenHeartbeat = listen("heartbeat_status", (event) => {
      console.log("heartbeat_status", event);
      setHeartbeatStatus(event.payload);
    });

    return () => {
      unlistenFileChange.then((fn) => fn());
      unlistenHeartbeat.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    // Load recent directories on mount
    loadRecentDirs();
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

  function getEventTypeColor(eventType: string): string {
    switch (eventType) {
      case "initial":
        return "bg-gray-500";
      case "created":
        return "bg-green-500";
      case "modified":
        return "bg-blue-500";
      case "deleted":
        return "bg-red-500";
      default:
        return "bg-gray-500";
    }
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
    return '...' + path.slice(-(maxLength - 3));
  }

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
                  Stop Watching
                </Button>
              </div>
            )}

            {/* Recent Directories */}
            {recentDirs.length > 0 && !selectedFolder && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Recent folders</p>
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
                  <p className="text-xs text-muted-foreground mb-1">Currently watching</p>
                    
                  <p className="text-sm font-semibold break-all">{selectedFolder}</p>
                </div>
                
                
                  
              </div>
            )}

        {/* File Changes */}
        {selectedFolder && (
          <Card>
            <CardHeader>
              <CardTitle>File Changes</CardTitle>
              <CardDescription>
                Real-time file system changes in the selected folder
              </CardDescription>
            </CardHeader>
            <CardContent>
              {fileChanges.length === 0 ? (
                <p className="text-muted-foreground text-center text-sm py-4">
                  No files found
                </p>
              ) : (
                <ScrollArea className="h-96">
                  <div className="space-y-1">
                    {fileChanges.map((change, index) => (
                      <div
                        key={`${change.path}-${change.timestamp}-${index}`}
                        className="flex items-center py-2 rounded-sm w-full"
                      >
                        <div className="flex-1 min-w-0 pr-3">
                          <p 
                            className="text-sm font-medium truncate"
                            title={getRelativePath(change.path)}
                          >
                            {truncatePathFromStart(getRelativePath(change.path))}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Badge
                            variant="secondary"
                            className={`${getEventTypeColor(
                              change.event_type
                            )} text-white text-xs`}
                          >
                            {change.event_type}
                          </Badge>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatTimestamp(change.timestamp)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        )}

        {/* Upload Management */}
        {selectedFolder && (
          <div className="mb-8">
            <UploadManager />
          </div>
        )}
      </div>

      {/* VS Code Style Status Ribbon */}
      <div className="fixed bottom-0 left-0 right-0 bg-background border-t text-xs px-4 py-0.25 flex items-center justify-between z-50">
        <div className="flex items-center space-x-4">
          <Tooltip>
            <TooltipTrigger>

          <div className="flex items-center space-x-1.5">
            <div className={`w-2 h-2 rounded-full ${heartbeatStatus?.status?.status === 'online' ? 'bg-green-500' : 'bg-red-500'}`}></div>
            <span>{heartbeatStatus?.status?.status === 'online' ? 'Connected' : 'Disconnected'}</span>
          </div>
            </TooltipTrigger>
              <TooltipContent collisionPadding={8}>
                {
                  heartbeatStatus?.status?.status === 'online' ? (
                    <>
                      <span>Online since</span>{' '}
                      {new Date(heartbeatStatus?.status?.first_seen).toLocaleString(
                        undefined,
                        { dateStyle: "short", timeStyle: "short" }
                      )}
                  </>
                ) : heartbeatStatus?.status?.last_seen ? (
                  <>
                    <span>Offline since</span>{' '}
                    {new Date(heartbeatStatus?.status?.last_seen).toLocaleString(
                      undefined,
                      { dateStyle: "short", timeStyle: "short" }
                    )}
                  </>
                ) : (
                  <>
                    <span>Offline</span>
                  </>
                )
                }
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center space-x-4">
          <span>{(() => {
            const actualChanges = fileChanges.filter(change => change.event_type !== 'initial').length;
            return actualChanges >= 100 ? '100+' : actualChanges;
          })()} changes detected</span>
          <UploadSettingsSheet>
            <button className="hover:bg-muted p-1 rounded">
              <Settings2Icon className="w-3 h-3" />
            </button>
          </UploadSettingsSheet>
        </div>
      </div>
    </main>
  );
}