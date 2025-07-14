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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FileChangeEvent } from "@/types";
import UploadManager from "./UploadManager";
import UploadSettingsDialog from "./UploadSettingsDialog";
import { getRecentDirs, pushRecent } from "@/lib/store";

export default function Simple() {
  const [selectedFolder, setSelectedFolder] = useState("");
  const [isWatching, setIsWatching] = useState(false);
  const [fileChanges, setFileChanges] = useState<FileChangeEvent[]>([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [recentDirs, setRecentDirs] = useState<string[]>([]);

  useEffect(() => {
    // Listen for file change events from Tauri
    const unlisten = listen("file_change", (event) => {
      const fileChange = event.payload as FileChangeEvent;
      setFileChanges((prev) => [fileChange, ...prev].slice(0, 100)); // Keep only latest 100 changes
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    // Listen for online/offline events
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
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
      if (isWatching) {
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
        setIsWatching(true);
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
      setIsWatching(false);
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
    // return path.split(/[/\\]/).pop() || path;
    return path;
  }

  return (
    <main className="container mx-auto p-6 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6">File Watcher</h1>

      <div className="space-y-6">
        {/* Folder Selection */}
        <Card>
          {/* <CardHeader>
            <CardTitle>Folder Selection</CardTitle>
            <CardDescription>
              Choose a folder to monitor for file changes
            </CardDescription>
          </CardHeader> */}
          <CardContent className="space-y-4">
            <Button onClick={selectFolder} className="w-full sm:w-auto">
              Select Folder
            </Button>

            {/* Recent Directories */}
            {recentDirs.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Recent folders:</p>
                <div className="flex flex-col gap-1 items-start">
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
              <div className="p-3 bg-muted rounded-md">
                <p className="text-sm text-muted-foreground mb-1">Selected Folder:</p>
                <p className="font-mono text-sm break-all">{selectedFolder}</p>
              </div>
            )}

            {isWatching && (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-sm text-green-600 font-medium">
                    Watching for changes...
                  </span>
                </div>
                <Button onClick={stopWatching} variant="outline" size="sm">
                  Stop Watching
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* File Changes */}
        {isWatching && (
          <Card>
            <CardHeader>
              <CardTitle>File Changes</CardTitle>
              <CardDescription>
                Real-time file system changes in the selected folder
              </CardDescription>
            </CardHeader>
            <CardContent>
              {fileChanges.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  Loading folder contents...
                </p>
              ) : (
                <ScrollArea className="h-96">
                  <div className="space-y-1">
                    {fileChanges.map((change, index) => (
                      <div
                        key={`${change.path}-${change.timestamp}-${index}`}
                        className="flex items-center justify-between py-2 rounded-sm"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {getRelativePath(change.path)}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 ml-4">
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
        <UploadManager />
      </div>

      {/* VS Code Style Status Ribbon */}
      <div className="fixed bottom-0 left-0 right-0 bg-background border-t text-xs px-4 py-0.25 flex items-center justify-between z-50">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'}`}></div>
            <span>{isOnline ? 'Connected' : 'Disconnected'}</span>
          </div>
        </div>
        <div className="flex items-center space-x-4">
          <span>{fileChanges.length} changes detected</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <UploadSettingsDialog>
                  <button className="hover:bg-muted p-1 rounded">
                    <Settings2Icon className="w-3 h-3" />
                  </button>
                </UploadSettingsDialog>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>Upload Settings</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </main>
  );
}