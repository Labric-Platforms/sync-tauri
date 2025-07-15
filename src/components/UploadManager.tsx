import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useUploadManager } from "@/hooks/useUploadManager";

function UploadManager() {
  const {
    config,
    progress,
    queueSize,
    isLoading,
    error,
    clearQueue,
  } = useUploadManager();

  const handleClearQueue = async () => {
    try {
      await clearQueue();
    } catch (err) {
      console.error("Failed to clear queue:", err);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground">Loading upload configuration...</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-red-500">Error: {error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!config) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground">No upload configuration available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload Status</CardTitle>
        <CardDescription>Current upload system status and controls</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">


        {progress && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Queued:</span>
              <p className="font-medium">{progress.total_queued}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Uploaded:</span>
              <p className="font-medium text-green-600">{progress.total_uploaded}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Failed:</span>
              <p className="font-medium text-red-600">{progress.total_failed}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Current:</span>
              <p className="font-medium truncate">
                {progress.current_uploading || "None"}
              </p>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={handleClearQueue} variant="outline" size="sm">
            Clear Queue ({queueSize})
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default UploadManager; 