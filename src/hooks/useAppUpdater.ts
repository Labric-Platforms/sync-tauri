import { useEffect } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { toast } from 'sonner';

export function useAppUpdater() {
  useEffect(() => {
    // Check for app updates on startup
    const checkForUpdates = async () => {
      try {
        const update = await check();
        if (update) {
          console.log(
            `found update ${update.version} from ${update.date} with notes ${update.body}`
          );
          let downloaded = 0;
          let contentLength = 0;
          // alternatively we could also call update.download() and update.install() separately
          await update.download(
            (event) => {
              switch (event.event) {
                case 'Started':
                  contentLength = event.data.contentLength ?? 0;
                  console.log(`started downloading ${event.data.contentLength ?? 0} bytes`);
                  break;
                case 'Progress':
                  downloaded += event.data.chunkLength;
                  console.log(`downloaded ${downloaded} from ${contentLength}`);
                  break;
                case 'Finished':
                  console.log('download finished');
                  break;
              }
            }
          );

          console.log('update downloaded');
          
          toast(`New Update v${update.version}`, {
            id: "update-notification",
            description: "Restart to install the update",
            action: {
              label: "Restart",
              onClick: async () => {
                try {
                  toast.loading("Installing update...", { id: 'installing' });
                  await update.install();
                  console.log('update installed');
                  toast.dismiss('installing');
                  await relaunch();
                } catch (error) {
                  console.error('Failed to install update:', error);
                  toast.dismiss('installing');
                  toast.error("Failed to install update");
                }
              },
            },
            cancel: {
              label: "Later",
              onClick: () => {
                console.log("Update postponed");
              },
            },
            duration: Infinity,
          })
          // wait for 15 seconds
          await new Promise(resolve => setTimeout(resolve, 15000));
          // await relaunch();
        }
      } catch (error) {
        console.error('Failed to check for updates:', error);
      }
    };

    checkForUpdates();
  }, []);
} 