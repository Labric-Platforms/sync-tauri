import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

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
import { FileChangeEvent, DeviceInfo } from "@/types";

function FileWatcher() {
  const [selectedFolder, setSelectedFolder] = useState("");
  const [isWatching, setIsWatching] = useState(false);
  const [fileChanges, setFileChanges] = useState<FileChangeEvent[]>([]);
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);

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
    // Gather device information
    const getDeviceInfo = async () => {
      try {
        const info = (await invoke("get_device_info")) as DeviceInfo;
        setDeviceInfo(info);
      } catch (error) {
        console.error("Failed to get device info:", error);
        // Fallback device info
        setDeviceInfo({
          hostname: "Unknown",
          platform: "Unknown",
          release: "Unknown",
          arch: "Unknown",
          cpus: 0,
          total_memory: 0,
          os_type: "Unknown",
          device_id: "Unknown",
          device_fingerprint: "Unknown",
        });
      }
    };

    getDeviceInfo();
  }, []);



  async function selectFolder() {
    try {
      const folderPath = await open({
        directory: true,
        multiple: false,
      });

      if (folderPath) {
        // Stop watching previous folder if any
        if (isWatching) {
          await stopWatching();
        }

        setSelectedFolder(folderPath as string);
        setFileChanges([]); // Clear previous changes

        // Automatically start watching the new folder
        try {
          await invoke("start_watching", { folderPath: folderPath as string });
          setIsWatching(true);
        } catch (err) {
          console.error("Failed to start watching:", err);
        }
      }
    } catch (err) {
      console.error(err);
    }
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

  return (
    <main className="container mx-auto p-6 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6">File Watcher</h1>

      <div className="space-y-6">
        {/* Folder Selection */}
        <Card>
          <CardHeader>
            <CardTitle>Folder Selection</CardTitle>
            <CardDescription>
              Choose a folder to monitor for file changes
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={selectFolder} className="w-full sm:w-auto">
              Select Folder
            </Button>

            {selectedFolder && (
              <div className="p-3 bg-gray-100 rounded-md">
                <p className="text-sm text-gray-600 mb-1">Selected Folder:</p>
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
                <p className="text-gray-500 text-center py-8">
                  Loading folder contents...
                </p>
              ) : (
                <ScrollArea className="h-96">
                  <div className="space-y-1">
                    {fileChanges.map((change, index) => (
                      <div
                        key={`${change.path}-${change.timestamp}-${index}`}
                        className="flex items-center justify-between py-2 px-1 hover:bg-gray-50 rounded-sm"
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
                          <span className="text-xs text-gray-400 whitespace-nowrap">
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

        {/* Device Information */}
        <Card>
          <CardHeader>
            <CardTitle>Device Information</CardTitle>
            <CardDescription>
              Comprehensive system and hardware details
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!deviceInfo ? (
              <p className="text-gray-500">Loading device information...</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
                <div className="space-y-3">
                  <div>
                    <span className="font-medium text-gray-600">
                      Device Name:
                    </span>
                    <p className="text-gray-900">{deviceInfo.hostname}</p>
                  </div>
                  <div>
                    <span className="font-medium text-gray-600">Platform:</span>
                    <p className="text-gray-900">{deviceInfo.platform}</p>
                  </div>
                  <div>
                    <span className="font-medium text-gray-600">
                      OS Version:
                    </span>
                    <p className="text-gray-900">{deviceInfo.release}</p>
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <span className="font-medium text-gray-600">
                      Architecture:
                    </span>
                    <p className="text-gray-900">{deviceInfo.arch}</p>
                  </div>
                  <div>
                    <span className="font-medium text-gray-600">
                      CPU Cores:
                    </span>
                    <p className="text-gray-900">{deviceInfo.cpus}</p>
                  </div>
                  <div>
                    <span className="font-medium text-gray-600">Memory:</span>
                    <p className="text-gray-900">
                      {deviceInfo.total_memory} GB
                    </p>
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <span className="font-medium text-gray-600">
                      Device ID:
                    </span>
                    <p className="text-gray-900 font-mono text-xs break-all">
                      {deviceInfo.device_id}
                    </p>
                  </div>
                  <div>
                    <span className="font-medium text-gray-600">
                      Fingerprint:
                    </span>
                    <p className="text-gray-900 font-mono text-xs break-all">
                      {deviceInfo.device_fingerprint.substring(0, 16)}...
                    </p>
                  </div>
                  <div>
                    <span className="font-medium text-gray-600">Runtime:</span>
                    <p className="text-gray-900">Tauri + React</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

export default FileWatcher;
